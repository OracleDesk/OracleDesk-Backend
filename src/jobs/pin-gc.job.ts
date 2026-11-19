/**
 * IPFS pin garbage collection (#328).
 *
 * 1. Reconcile: anchor any reference whose owner is already on chain, so a
 *    missed hook can never lead to an unpin.
 * 2. Release: give up references whose owner never reached the chain and is
 *    past the grace period (cancelled markets, failed publications).
 * 3. Unpin: pins whose references are all RELEASED, rate limited, safe with
 *    several instances (the claim uses FOR UPDATE SKIP LOCKED).
 *
 * When in doubt a reference stays CANDIDATE: keeping a pin only costs storage,
 * losing one makes a market question or trace unverifiable.
 */
import { config } from '../config';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { sleep } from '../lib/resilience';
import { sha256Hex } from '../utils/hash.util';
import { getContentStore } from '../services/content-store.service';
import { getIpfsTransport, providerStatus, type IpfsTransport } from '../services/ipfs.service';
import { getPinLedger, type PinLedger, type PinRef } from '../services/pin-ledger.service';

export type OwnerVerdict =
  | { verdict: 'ANCHORED'; anchor: string }
  | { verdict: 'RELEASE' }
  | { verdict: 'KEEP' };

/** Decides what a CANDIDATE reference's owner currently allows. */
export type OwnerResolver = (ref: PinRef, now: Date, graceMs: number) => Promise<OwnerVerdict>;

const IN_FLIGHT_OUTBOX = ['BUILT', 'SIGNED', 'SUBMITTED', 'PENDING'] as const;

/** Production resolver: reads the owner rows. Anything ambiguous is KEEP. */
export const prismaOwnerResolver: OwnerResolver = async (ref, now, graceMs) => {
  const old = (d: Date) => now.getTime() - d.getTime() >= graceMs;

  if (ref.ownerKind === 'MARKET_QUESTION') {
    const market = await prisma.market.findUnique({
      where: { id: ref.ownerId },
      select: { onChainMarketId: true, status: true, createdAt: true, creationAttempt: { select: { status: true } } },
    });
    if (!market) return { verdict: 'RELEASE' };
    if (market.onChainMarketId != null) return { verdict: 'ANCHORED', anchor: `market:${market.onChainMarketId.toString()}` };

    const attempt = market.creationAttempt?.status;
    if (attempt === 'CLAIMED' || attempt === 'SUBMITTED' || attempt === 'LANDED' || attempt === 'UNKNOWN') {
      return { verdict: 'KEEP' };
    }
    const inFlight = await prisma.chainTransaction.count({
      where: { kind: 'market.create', refId: ref.ownerId, status: { in: [...IN_FLIGHT_OUTBOX] as never[] } },
    });
    if (inFlight > 0) return { verdict: 'KEEP' };

    if (market.status === 'CANCELLED') return { verdict: 'RELEASE' };
    // Dry-run markets stay PENDING forever; their document never reaches the chain.
    if (market.status === 'PENDING' && old(market.createdAt)) return { verdict: 'RELEASE' };
    return { verdict: 'KEEP' };
  }

  if (ref.ownerKind === 'TRACE') {
    const trace = await prisma.reasoningTrace.findUnique({
      where: { id: ref.ownerId },
      select: { onChainTraceId: true, publication: { select: { status: true, updatedAt: true } } },
    });
    if (!trace) return { verdict: 'RELEASE' };
    if (trace.onChainTraceId != null) return { verdict: 'ANCHORED', anchor: `trace:${trace.onChainTraceId.toString()}` };
    if (trace.publication?.status === 'FAILED' && old(trace.publication.updatedAt)) return { verdict: 'RELEASE' };
    return { verdict: 'KEEP' };
  }

  // DOCUMENT references are anchored when published; otherwise kept.
  return { verdict: 'KEEP' };
};

export interface PinGcOptions {
  ledger?: PinLedger;
  transport?: IpfsTransport;
  resolveOwner?: OwnerResolver;
  now?: Date;
  graceMs?: number;
  batch?: number;
  ratePerMin?: number;
  /** Test seam for the pause between unpin calls. */
  pause?: (ms: number) => Promise<void>;
}

export interface PinGcResult {
  anchored: number;
  released: number;
  unpinned: number;
  repinned: number;
  failed: number;
  /** True when the run stopped early on repeated provider rate limiting. */
  rateLimited: boolean;
}

const MAX_CONSECUTIVE_429 = 3;
const BACKOFF_BASE_MS = 2_000;

export async function runPinGc(opts: PinGcOptions = {}): Promise<PinGcResult> {
  const ledger = opts.ledger ?? getPinLedger();
  const transport = opts.transport ?? getIpfsTransport();
  const resolveOwner = opts.resolveOwner ?? prismaOwnerResolver;
  const now = opts.now ?? new Date();
  const graceMs = opts.graceMs ?? config.PIN_GC_GRACE_HOURS * 3_600_000;
  const batch = opts.batch ?? config.PIN_GC_BATCH;
  const ratePerMin = Math.max(1, opts.ratePerMin ?? config.PIN_GC_RATE_PER_MIN);
  const pause = opts.pause ?? ((ms: number) => sleep(ms));
  const result: PinGcResult = { anchored: 0, released: 0, unpinned: 0, repinned: 0, failed: 0, rateLimited: false };

  // 1 + 2: reconcile references against their owners.
  for (const ref of await ledger.listCandidateRefs()) {
    let verdict: OwnerVerdict;
    try {
      verdict = await resolveOwner(ref, now, graceMs);
    } catch (err) {
      logger.warn({ err, ref }, 'Pin GC: owner lookup failed; keeping reference');
      continue;
    }
    if (verdict.verdict === 'ANCHORED') {
      result.anchored += await ledger.anchor({ kind: ref.ownerKind, id: ref.ownerId }, verdict.anchor);
    } else if (verdict.verdict === 'RELEASE') {
      await ledger.release(ref);
      result.released++;
    }
  }

  if (!transport.unpin) {
    logger.warn('Pin GC: the IPFS transport cannot unpin; skipping the unpin phase');
    return result;
  }

  // 3: unpin.
  const claimed = await ledger.claimUnpinnable(new Date(now.getTime() - graceMs), batch);
  let consecutive429 = 0;
  for (let i = 0; i < claimed.length; i++) {
    const pin = claimed[i];
    if (result.rateLimited) {
      // Stopped early: hand the remaining claims back untouched.
      await ledger.restorePinned(pin.cid);
      continue;
    }
    try {
      await transport.unpin(pin.cid);
      consecutive429 = 0;
    } catch (err) {
      if (providerStatus(err) === 429) {
        consecutive429++;
        await ledger.restorePinned(pin.cid, 'rate limited');
        if (consecutive429 >= MAX_CONSECUTIVE_429) {
          result.rateLimited = true;
          logger.warn({ consecutive429 }, 'Pin GC: provider keeps rate limiting; stopping this run');
        } else {
          await pause(BACKOFF_BASE_MS * 2 ** (consecutive429 - 1));
        }
        continue;
      }
      result.failed++;
      logger.warn({ err, cid: pin.cid }, 'Pin GC: unpin failed; pin kept');
      await ledger.restorePinned(pin.cid, err instanceof Error ? err.message : String(err));
      continue;
    }

    const { repin } = await ledger.finishUnpin(pin.cid, now);
    result.unpinned++;
    if (repin) {
      // A new pin of the same bytes arrived while the unpin was in flight.
      if (await repinFromStore(pin.cid, pin.sha256, transport, ledger)) result.repinned++;
    }
    if (i < claimed.length - 1) await pause(Math.ceil(60_000 / ratePerMin));
  }

  logger.info(result, 'Pin GC run finished');
  return result;
}

async function repinFromStore(cid: string, sha256: string, transport: IpfsTransport, ledger: PinLedger): Promise<boolean> {
  try {
    const cached = await getContentStore().get(cid);
    if (!cached || sha256Hex(cached.bytes) !== sha256.toLowerCase()) {
      logger.error({ cid }, 'Pin GC: re-pin requested but verified bytes are not in the content store');
      return false;
    }
    await transport.pin(cached.bytes, `oracledesk-repin-${cid.slice(0, 16)}`);
    await ledger.acquire({ cid, sha256, size: cached.bytes.length, provider: config.IPFS_TRANSPORT === 'local' ? 'local' : 'pinata' });
    await ledger.markPinned(cid);
    return true;
  } catch (err) {
    logger.error({ err, cid }, 'Pin GC: re-pin failed');
    return false;
  }
}
