/**
 * Health-scored, hedged, hash-verified multi-gateway IPFS fetcher (#271).
 *
 * - Orders gateways by an in-memory EWMA of success rate and latency.
 * - Starts the highest-scored gateway first, hedges to the next after
 *   `IPFS_HEDGE_DELAY_MS` (or immediately on failure), caps concurrency at
 *   two active legs, takes the first verified response, and aborts losing legs.
 * - Verifies bytes against CIDv1 raw/sha2-256 digest (or `expectedSha256`) so
 *   malicious or HTML-error-page gateway responses are rejected and penalized.
 */
import axios from 'axios';
import crypto from 'node:crypto';
import { config } from '../../config';
import { logger } from '../../lib/logger';
import { AppError } from '../../middlewares/error.middleware';

const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

export function base32Decode(str: string): Buffer | null {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of str.toLowerCase()) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/**
 * Extracts the embedded 32-byte sha2-256 digest from a CIDv1 raw/sha2-256 CID
 * (`b...` multibase -> `0x01 0x55 0x12 0x20 <32 bytes>`). Returns `null` for
 * other CID formats (e.g. CIDv0 or dag-pb), which require `expectedSha256`.
 */
export function extractRawCidSha256(cid: string): string | null {
  if (!cid.startsWith('b')) return null;
  const decoded = base32Decode(cid.slice(1));
  if (!decoded || decoded.length !== 36) return null;
  if (decoded[0] !== 0x01 || decoded[1] !== 0x55 || decoded[2] !== 0x12 || decoded[3] !== 0x20) {
    return null;
  }
  return decoded.subarray(4, 36).toString('hex');
}

export function verifyGatewayBytes(cid: string, bytes: Buffer, expectedSha256?: string): boolean {
  const actual = crypto.createHash('sha256').update(bytes).digest('hex');
  const embedded = extractRawCidSha256(cid);
  if (embedded) {
    if (actual !== embedded) return false;
  } else if (!expectedSha256) {
    return false;
  }
  if (expectedSha256) {
    const normalized = expectedSha256.toLowerCase().replace(/^0x/, '');
    if (actual !== normalized) return false;
  }
  return true;
}

interface GatewayMetrics {
  ewmaLatencyMs: number;
  ewmaSuccess: number;
  samples: number;
}

export class GatewayHealthTracker {
  private readonly metrics = new Map<string, GatewayMetrics>();
  private readonly alpha = 0.3;

  recordSuccess(gateway: string, latencyMs: number): void {
    const prev = this.metrics.get(gateway);
    if (!prev) {
      this.metrics.set(gateway, { ewmaLatencyMs: latencyMs, ewmaSuccess: 1, samples: 1 });
      return;
    }
    this.metrics.set(gateway, {
      ewmaLatencyMs: this.alpha * latencyMs + (1 - this.alpha) * prev.ewmaLatencyMs,
      ewmaSuccess: this.alpha * 1 + (1 - this.alpha) * prev.ewmaSuccess,
      samples: prev.samples + 1,
    });
  }

  recordFailure(gateway: string): void {
    const prev = this.metrics.get(gateway) ?? { ewmaLatencyMs: 2_000, ewmaSuccess: 0.5, samples: 0 };
    this.metrics.set(gateway, {
      ewmaLatencyMs: Math.min(30_000, prev.ewmaLatencyMs * 1.5),
      ewmaSuccess: (1 - this.alpha) * prev.ewmaSuccess,
      samples: prev.samples + 1,
    });
  }

  score(gateway: string): number {
    const m = this.metrics.get(gateway);
    if (!m) return 1.0; // unmeasured gateways start neutral-optimistic
    return m.ewmaSuccess / (1 + m.ewmaLatencyMs / 1000);
  }

  order(gateways: string[]): string[] {
    return [...gateways].sort((a, b) => this.score(b) - this.score(a));
  }
}

export const defaultGatewayHealth = new GatewayHealthTracker();

export function configuredGateways(): string[] {
  if (config.IPFS_GATEWAYS.length > 0) return config.IPFS_GATEWAYS;
  return [config.IPFS_GATEWAY_URL, 'https://ipfs.io/ipfs'];
}

export interface FetchVerifiedOptions {
  expectedSha256?: string;
  signal?: AbortSignal;
  maxBytes?: number;
  gateways?: string[];
  hedgeDelayMs?: number;
  tracker?: GatewayHealthTracker;
}

/**
 * Fetches `cid` from health-scored gateways with hedged fallback (max 2 active
 * legs), aborting losing legs immediately and verifying every byte against the
 * CID digest / `expectedSha256` (#271).
 */
export async function fetchVerified(
  cid: string,
  opts: FetchVerifiedOptions = {},
): Promise<{ bytes: Buffer; gateway: string }> {
  const tracker = opts.tracker ?? defaultGatewayHealth;
  const gateways = tracker.order(opts.gateways ?? configuredGateways());
  if (gateways.length === 0) {
    throw new AppError(502, 'IPFS_RETRIEVAL_FAILED', 'No IPFS gateways configured', { cid });
  }

  const maxBytes = Math.min(opts.maxBytes ?? config.IPFS_MAX_BYTES, config.IPFS_MAX_BYTES);
  const hedgeDelayMs = opts.hedgeDelayMs ?? config.IPFS_HEDGE_DELAY_MS;
  const timeoutMs = config.TIMEOUT_IPFS_FETCH_MS;

  const fetchOne = async (
    gateway: string,
    legController: AbortController,
  ): Promise<{ bytes: Buffer; gateway: string }> => {
    const started = Date.now();
    const url = `${gateway.replace(/\/+$/, '')}/${encodeURIComponent(cid)}`;
    try {
      const { data } = await axios.get<ArrayBuffer>(url, {
        responseType: 'arraybuffer',
        timeout: timeoutMs,
        signal: legController.signal,
        maxContentLength: maxBytes,
        maxBodyLength: maxBytes,
      });
      const bytes = Buffer.from(data);
      if (bytes.length > maxBytes) {
        tracker.recordFailure(gateway);
        throw new AppError(413, 'IPFS_RESPONSE_TOO_LARGE', 'IPFS gateway response exceeded maxBytes', { cid, maxBytes });
      }
      if (!verifyGatewayBytes(cid, bytes, opts.expectedSha256)) {
        tracker.recordFailure(gateway);
        throw new Error(`Gateway ${gateway} returned bytes failing CID/hash verification`);
      }
      tracker.recordSuccess(gateway, Date.now() - started);
      return { bytes, gateway };
    } catch (err) {
      if (!legController.signal.aborted) {
        tracker.recordFailure(gateway);
        logger.warn({ gateway, cid, err: err instanceof Error ? err.message : String(err) }, 'IPFS gateway attempt failed');
      }
      throw err;
    }
  };

  // Race pairs with hedged launch (at most 2 legs active at once).
  for (let i = 0; i < gateways.length; i += 2) {
    if (opts.signal?.aborted) {
      throw opts.signal.reason ?? new Error('Aborted');
    }
    const primaryGw = gateways[i]!;
    const secondaryGw = gateways[i + 1];

    const c1 = new AbortController();
    const c2 = new AbortController();
    const onParentAbort = () => {
      c1.abort();
      c2.abort();
    };
    opts.signal?.addEventListener('abort', onParentAbort, { once: true });

    let hedgeTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!secondaryGw) {
        return await fetchOne(primaryGw, c1);
      }

      const result = await new Promise<{ bytes: Buffer; gateway: string }>((resolve, reject) => {
        let settled = false;
        let secondStarted = false;
        let failures = 0;
        let lastErr: unknown;

        const finish = (res: { bytes: Buffer; gateway: string }, loser: AbortController) => {
          if (settled) return;
          settled = true;
          if (hedgeTimer) clearTimeout(hedgeTimer);
          loser.abort();
          resolve(res);
        };

        const fail = (err: unknown) => {
          lastErr = err;
          failures += 1;
          if (!secondStarted) {
            if (hedgeTimer) clearTimeout(hedgeTimer);
            startSecond();
            return;
          }
          if (failures >= 2 && !settled) {
            settled = true;
            reject(lastErr);
          }
        };

        const startSecond = () => {
          if (secondStarted || settled) return;
          secondStarted = true;
          fetchOne(secondaryGw, c2).then((r) => finish(r, c1), fail);
        };

        fetchOne(primaryGw, c1).then((r) => finish(r, c2), fail);
        hedgeTimer = setTimeout(startSecond, hedgeDelayMs);
      });
      return result;
    } catch {
      // Proceed to next gateway pair if available.
    } finally {
      if (hedgeTimer) clearTimeout(hedgeTimer);
      opts.signal?.removeEventListener('abort', onParentAbort);
      c1.abort();
      c2.abort();
    }
  }

  throw new AppError(502, 'IPFS_RETRIEVAL_FAILED', 'Could not retrieve verified content from any IPFS gateway', { cid });
}
