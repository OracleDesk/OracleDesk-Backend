/**
 * IPFS pin replication & repair job (#271).
 *
 * Enumerates on-chain anchored CIDs across markets, reasoning traces, and
 * transparency reports, checks pin status across configured providers under a
 * Postgres advisory lock, repairs missing pins exclusively from verified bytes,
 * and emits CRITICAL alerts when an anchored CID is unrecoverable.
 */
import { config } from '../config';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { withAdvisoryLock } from '../lib/advisory-lock';
import { getContentStore } from '../services/content-store.service';
import { configuredPinProviders, type PinProvider } from '../services/ipfs/providers';
import { fetchVerified, verifyGatewayBytes } from '../services/ipfs/gateways';
import { cidForBytes } from '../services/ipfs.service';

export interface ReplicationJobDeps {
  providers?: PinProvider[];
  fetchBytes?: (cid: string) => Promise<Buffer>;
  alertCritical?: (title: string, details: Record<string, unknown>) => Promise<void>;
  maxItemsPerRun?: number;
  now?: () => number;
}

export interface ReplicationRunSummary {
  checked: number;
  repaired: number;
  failed: number;
  unrecoverable: string[];
}

/** Advisory-lock key: one replication sweep at a time across replicas. */
const REPLICATION_LOCK = 'oracledesk:ipfs_replication';

export async function enumerateAnchoredCids(): Promise<string[]> {
  const cids = new Set<string>();
  const [markets, traces, reports] = await Promise.all([
    prisma.market.findMany({
      where: { onChainMarketId: { not: null }, metaUri: { not: null } },
      select: { metaUri: true },
    }),
    prisma.reasoningTrace.findMany({
      where: { onChainTraceId: { not: null }, ipfsCid: { not: null } },
      select: { ipfsCid: true },
    }),
    (prisma as any).transparencyReport?.findMany?.({
      where: { cid: { not: null } },
      select: { cid: true },
    }) ?? [],
  ]);

  for (const m of markets) {
    if (m.metaUri) cids.add(m.metaUri.replace(/^ipfs:\/\//, '').trim());
  }
  for (const t of traces) {
    if (t.ipfsCid) cids.add(t.ipfsCid.replace(/^ipfs:\/\//, '').trim());
  }
  for (const r of reports as Array<{ cid?: string | null }>) {
    if (r.cid) cids.add(r.cid.replace(/^ipfs:\/\//, '').trim());
  }
  return [...cids].filter(Boolean);
}

async function defaultCriticalAlert(title: string, details: Record<string, unknown>): Promise<void> {
  logger.error({ alertSeverity: 'CRITICAL', ...details }, title);
  try {
    const mod = await import('../services/alerts.service');
    const svc = (mod as any).alertService ?? (mod as any).alerts;
    if (typeof svc?.send === 'function') {
      await svc.send({ severity: 'CRITICAL', title, details });
    } else if (typeof svc?.notify === 'function') {
      await svc.notify('CRITICAL', title, details);
    }
  } catch {
    // Already logged at error level above.
  }
}

/**
 * Resolves verified bytes for `cid`: first from the local content store (only
 * if bytes verify against `cid`), then from hedged multi-gateway fetch. Never
 * returns unverified bytes.
 */
async function resolveVerifiedBytesForRepair(
  cid: string,
  fetchBytes?: (cid: string) => Promise<Buffer>,
): Promise<Buffer | null> {
  const store = getContentStore();
  const cached = await store.get(cid).catch(() => null);
  if (cached && verifyGatewayBytes(cid, cached.bytes, cached.sha256)) {
    return cached.bytes;
  }

  try {
    const bytes = fetchBytes ? await fetchBytes(cid) : (await fetchVerified(cid)).bytes;
    if (!verifyGatewayBytes(cid, bytes)) {
      logger.error({ cid }, 'Repair fetched unverified bytes; refusing to re-pin');
      return null;
    }
    return bytes;
  } catch {
    return null;
  }
}

export async function runIpfsReplicationJob(
  deps: ReplicationJobDeps = {},
): Promise<ReplicationRunSummary> {
  const execute = async (): Promise<ReplicationRunSummary> => {
    const providers = deps.providers ?? configuredPinProviders();
    const providerMap = new Map(providers.map((p) => [p.name, p]));
    const now = deps.now ? deps.now() : Date.now();
    const recheckCutoff = new Date(now - config.IPFS_RECHECK_HOURS * 3_600_000);
    const maxItems = deps.maxItemsPerRun ?? 100;
    const alertCritical = deps.alertCritical ?? defaultCriticalAlert;

    const anchored = await enumerateAnchoredCids();
    for (const cid of anchored) {
      for (const provider of providers) {
        await (prisma as any).ipfsPin.upsert({
          where: { cid_provider: { cid, provider: provider.name } },
          create: { cid, provider: provider.name, state: 'PENDING' },
          update: {},
        });
      }
    }

    const candidates: Array<{ cid: string; provider: string; state: string; attempts: number }> =
      await (prisma as any).ipfsPin.findMany({
        where: {
          OR: [
            { state: { in: ['PENDING', 'MISSING', 'FAILED'] } },
            { state: 'PINNED', lastCheckedAt: { lt: recheckCutoff } },
            { state: 'PINNED', lastCheckedAt: null },
          ],
        },
        take: maxItems,
      });

    const summary: ReplicationRunSummary = { checked: 0, repaired: 0, failed: 0, unrecoverable: [] };

    for (const row of candidates) {
      const provider = providerMap.get(row.provider);
      if (!provider) continue;
      summary.checked += 1;

      const status = await provider.status(row.cid).catch(() => 'missing' as const);
      if (status === 'pinned') {
        await (prisma as any).ipfsPin.update({
          where: { cid_provider: { cid: row.cid, provider: row.provider } },
          data: { state: 'PINNED', lastCheckedAt: new Date(now), pinnedAt: new Date(now), lastError: null },
        });
        continue;
      }
      if (status === 'pinning') {
        await (prisma as any).ipfsPin.update({
          where: { cid_provider: { cid: row.cid, provider: row.provider } },
          data: { state: 'PINNING', lastCheckedAt: new Date(now) },
        });
        continue;
      }

      // Missing on provider: repair from verified bytes only.
      const bytes = await resolveVerifiedBytesForRepair(row.cid, deps.fetchBytes);
      if (!bytes) {
        summary.failed += 1;
        summary.unrecoverable.push(row.cid);
        await (prisma as any).ipfsPin.update({
          where: { cid_provider: { cid: row.cid, provider: row.provider } },
          data: {
            state: 'FAILED',
            attempts: row.attempts + 1,
            lastCheckedAt: new Date(now),
            lastError: 'Unrecoverable: no verified bytes available from store or gateways',
          },
        });
        await alertCritical('Unrecoverable anchored IPFS CID', { cid: row.cid, provider: row.provider });
        continue;
      }

      try {
        const expected = cidForBytes(bytes);
        if (expected !== row.cid) {
          throw new Error(`Verified bytes CID ${expected} != anchored CID ${row.cid}`);
        }
        const pinnedCid = await provider.pin(bytes, `repair-${row.cid.slice(0, 12)}`, undefined, row.cid);
        if (pinnedCid !== row.cid) {
          throw new Error(`Provider ${provider.name} returned mismatched CID ${pinnedCid} (expected ${row.cid})`);
        }
        await (prisma as any).ipfsPin.update({
          where: { cid_provider: { cid: row.cid, provider: row.provider } },
          data: {
            state: 'PINNED',
            attempts: row.attempts + 1,
            lastCheckedAt: new Date(now),
            pinnedAt: new Date(now),
            lastError: null,
          },
        });
        summary.repaired += 1;
      } catch (err) {
        summary.failed += 1;
        await (prisma as any).ipfsPin.update({
          where: { cid_provider: { cid: row.cid, provider: row.provider } },
          data: {
            state: 'FAILED',
            attempts: row.attempts + 1,
            lastCheckedAt: new Date(now),
            lastError: err instanceof Error ? err.message : String(err),
          },
        });
      }
    }

    return summary;
  };

  if (deps.providers) {
    return execute();
  }
  const locked = await withAdvisoryLock(REPLICATION_LOCK, execute).catch(() => null);
  return locked?.acquired ? locked.value : { checked: 0, repaired: 0, failed: 0, unrecoverable: [] };
}

/** Replication counts by provider and state for `GET /admin/status` (#271). */
export async function getReplicationSummary(): Promise<{
  providers: string[];
  byProvider: Record<string, Record<string, number>>;
  totals: Record<string, number>;
}> {
  const rows: Array<{ provider: string; state: string; _count: { _all: number } }> =
    (await (prisma as any).ipfsPin?.groupBy?.({
      by: ['provider', 'state'],
      _count: { _all: true },
    })) ?? [];
  const byProvider: Record<string, Record<string, number>> = {};
  const totals: Record<string, number> = {};
  for (const r of rows) {
    const count = r._count?._all ?? 0;
    byProvider[r.provider] = byProvider[r.provider] ?? {};
    byProvider[r.provider][r.state] = count;
    totals[r.state] = (totals[r.state] ?? 0) + count;
  }
  return {
    providers: configuredPinProviders().map((p) => p.name),
    byProvider,
    totals,
  };
}
