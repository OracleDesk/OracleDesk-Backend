/**
 * Native balances and runway for the accounts that pay for chain writes (#220).
 *
 * The agent pays inner fees (unless a channel is the source), the fee payer
 * (FEE_PAYER_SECRET) pays fee bumps, and channels pay for the writes they
 * source. Balances come from rpc.Server.getAccountEntry (Int64 stroops, kept
 * as bigint end to end). /readyz is polled every HEALTH_CACHE_TTL_MS, so the
 * snapshot is cached for HEALTH_BALANCE_TTL_MS with a single-flight refresh
 * and is never refreshed while the rpc probe is failing.
 */
import { Keypair, type rpc } from '@stellar/stellar-sdk';
import { config } from '../../config';
import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';

export type BalanceRole = 'agent' | 'feePayer' | 'channel';

export interface AccountBalance {
  publicKey: string;
  role: BalanceRole;
  /** Native balance in stroops; null when it has never been read. */
  stroops: bigint | null;
  /** Base reserve for the account's subentries plus a safety margin. */
  minStroops: bigint;
  /** Hours until stroops reaches minStroops at the 24 h spend rate; null with no spend. */
  runwayHours: number | null;
  /** Runway derived from total_fee (fee_charged missing) or bump bids rather than charged fees. */
  estimated?: boolean;
  checkedAt: string | null;
  error?: 'account_missing' | 'unavailable';
}

export interface BalanceSnapshot {
  accounts: AccountBalance[];
  /** True when the last refresh was skipped (rpc probe failing) and values are carried over. */
  stale: boolean;
  takenAt: string | null;
}

export const STROOPS_PER_XLM = 10_000_000n;
/** Stellar base reserve: 0.5 XLM per (2 + numSubEntries). */
export const BASE_RESERVE_STROOPS = 5_000_000n;
/** Headroom above the reserve so the account can still pay at least a few fees. */
export const BALANCE_MARGIN_STROOPS = 10_000_000n;

export function reserveStroops(numSubEntries: number): bigint {
  return (2n + BigInt(numSubEntries)) * BASE_RESERVE_STROOPS + BALANCE_MARGIN_STROOPS;
}

/** XLM config values (CHANNEL_MIN_BALANCE_XLM) to stroops without float drift on the balance side. */
export function xlmToStroops(xlm: number): bigint {
  return BigInt(Math.round(xlm * 1e7));
}

type EntryServer = Pick<rpc.Server, 'getAccountEntry'>;

/** Balance and subentry count from the ledger entry. Throws for an account that does not exist. */
export async function readNativeAccount(server: EntryServer, pub: string): Promise<{ stroops: bigint; numSubEntries: number }> {
  const entry = await server.getAccountEntry(pub);
  return { stroops: BigInt(entry.balance().toString()), numSubEntries: Number(entry.numSubEntries()) };
}

export async function readNativeBalance(server: EntryServer, pub: string): Promise<bigint> {
  return (await readNativeAccount(server, pub)).stroops;
}

/** getAccountEntry wraps every lookup failure as "Account not found: G…". */
export function isAccountMissing(err: unknown): boolean {
  return err instanceof Error && /account not found/i.test(err.message);
}

/** (stroops − min) / hourly spend, two decimals; 0 below the minimum, null with no spend. */
export function runwayHours(stroops: bigint, minStroops: bigint, spend24h: bigint): number | null {
  if (spend24h <= 0n) return null;
  if (stroops <= minStroops) return 0;
  return Number(((stroops - minStroops) * 24n * 100n) / spend24h) / 100;
}

export interface Spend24h {
  agent: bigint;
  feePayer: bigint;
  /** Some agent fees fell back to total_fee because fee_charged was null. */
  agentEstimated: boolean;
}

/**
 * Agent spend: chain_fees over 24 h (fee_charged, else total_fee). chain_fees
 * has no source column, so channel-sourced writes count against the agent too;
 * the runway is conservative when channels are configured.
 * Fee-payer spend: the bid fee of every bump built in the window.
 */
export async function readSpend24h(): Promise<Spend24h> {
  const [fees] = await prisma.$queryRaw<Array<{ spend: bigint | null; estimated: boolean | null }>>`
    SELECT sum(COALESCE("fee_charged", "total_fee"))::bigint AS spend,
           bool_or("fee_charged" IS NULL) AS estimated
    FROM "chain_fees"
    WHERE "created_at" > now() - interval '24 hours'`;
  const [bumps] = await prisma.$queryRaw<Array<{ spend: bigint | null }>>`
    SELECT sum((e->>'fee')::bigint)::bigint AS spend
    FROM "chain_transactions" t,
         jsonb_array_elements(CASE WHEN jsonb_typeof(t."feeBumpEnvelopes") = 'array' THEN t."feeBumpEnvelopes" ELSE '[]'::jsonb END) e
    WHERE t."updatedAt" > now() - interval '24 hours'
      AND e->>'fee' ~ '^[0-9]+$'
      AND (e->>'at')::timestamptz > now() - interval '24 hours'`;
  return {
    agent: fees?.spend ?? 0n,
    feePayer: bumps?.spend ?? 0n,
    agentEstimated: Boolean(fees?.estimated),
  };
}

export interface ChannelBalanceView {
  publicKey: string;
  lastBalanceStroops: bigint | null;
  lastCheckedAt: string | null;
}

export interface BalanceMonitorDeps {
  server: EntryServer;
  /** Agent and fee-payer accounts to read (public keys only). */
  signers: () => Array<{ publicKey: string; role: 'agent' | 'feePayer' }>;
  /** Channel balances as last read by ChannelPool.checkBalances (no extra RPC). */
  channels: () => ReadonlyArray<ChannelBalanceView>;
  channelMinStroops: () => bigint;
  spend: () => Promise<Spend24h>;
  ttlMs: number;
  now?: () => number;
}

export function createBalanceMonitor(deps: BalanceMonitorDeps) {
  const now = deps.now ?? Date.now;
  let last: { accounts: AccountBalance[]; at: number } | null = null;
  let inflight: Promise<AccountBalance[]> | null = null;

  function channelRows(): AccountBalance[] {
    const min = deps.channelMinStroops();
    return deps.channels().map((c) => ({
      publicKey: c.publicKey,
      role: 'channel' as const,
      stroops: c.lastBalanceStroops,
      minStroops: min,
      runwayHours: null,
      checkedAt: c.lastCheckedAt,
    }));
  }

  async function refresh(): Promise<AccountBalance[]> {
    const spend = await deps.spend().catch((err) => {
      logger.warn({ err: err instanceof Error ? err.message : err }, 'balances: could not read 24 h spend');
      return null;
    });
    const checkedAt = new Date(now()).toISOString();
    const signers = await Promise.all(
      deps.signers().map(async ({ publicKey, role }): Promise<AccountBalance> => {
        const spent = role === 'agent' ? spend?.agent : spend?.feePayer;
        try {
          const { stroops, numSubEntries } = await readNativeAccount(deps.server, publicKey);
          const minStroops = reserveStroops(numSubEntries);
          return {
            publicKey,
            role,
            stroops,
            minStroops,
            runwayHours: spent == null ? null : runwayHours(stroops, minStroops, spent),
            // Bumps are recorded at their bid fee; agent fees fall back to total_fee.
            ...(spent ? { estimated: role === 'feePayer' || Boolean(spend?.agentEstimated) } : {}),
            checkedAt,
          };
        } catch (err) {
          if (isAccountMissing(err)) {
            return { publicKey, role, stroops: 0n, minStroops: reserveStroops(0), runwayHours: 0, checkedAt, error: 'account_missing' };
          }
          // Carry the previous reading rather than reporting an unknown as zero.
          const prev = last?.accounts.find((a) => a.publicKey === publicKey && a.role === role);
          return { ...(prev ?? { publicKey, role, stroops: null, minStroops: reserveStroops(0), runwayHours: null, checkedAt: null }), error: 'unavailable' };
        }
      }),
    );
    return [...signers, ...channelRows()];
  }

  return {
    /**
     * Cached snapshot. Refreshes at most once per ttl (one in-flight refresh
     * shared by concurrent callers); when rpcOk is false the last snapshot is
     * returned with stale: true and no RPC call is made.
     */
    async snapshot(rpcOk = true): Promise<BalanceSnapshot> {
      if (last && now() - last.at < deps.ttlMs) {
        return { accounts: [...last.accounts.filter((a) => a.role !== 'channel'), ...channelRows()], stale: false, takenAt: new Date(last.at).toISOString() };
      }
      if (!rpcOk) {
        const accounts = last ? last.accounts.filter((a) => a.role !== 'channel') : [];
        return { accounts: [...accounts, ...channelRows()], stale: true, takenAt: last ? new Date(last.at).toISOString() : null };
      }
      if (!inflight) {
        inflight = refresh()
          .then((accounts) => {
            last = { accounts, at: now() };
            return accounts;
          })
          .finally(() => {
            inflight = null;
          });
      }
      const accounts = await inflight;
      return { accounts, stale: false, takenAt: new Date(last?.at ?? now()).toISOString() };
    },
    /** Last snapshot without refreshing (admin status). */
    peek(): BalanceSnapshot {
      const accounts = last ? last.accounts.filter((a) => a.role !== 'channel') : [];
      return { accounts: [...accounts, ...channelRows()], stale: false, takenAt: last ? new Date(last.at).toISOString() : null };
    },
  };
}

export type BalanceMonitor = ReturnType<typeof createBalanceMonitor>;

/** Agent always; fee payer only when fee bumps are enabled. */
export function configuredSigners(): Array<{ publicKey: string; role: 'agent' | 'feePayer' }> {
  const out: Array<{ publicKey: string; role: 'agent' | 'feePayer' }> = [];
  try {
    if (config.AGENT_SECRET_KEY) out.push({ publicKey: Keypair.fromSecret(config.AGENT_SECRET_KEY).publicKey(), role: 'agent' });
    if (config.FEE_BUMP_ENABLED && config.FEE_PAYER_SECRET) {
      out.push({ publicKey: Keypair.fromSecret(config.FEE_PAYER_SECRET).publicKey(), role: 'feePayer' });
    }
  } catch {
    /* config validation already rejects malformed seeds */
  }
  return out;
}

/** JSON-safe view (bigint → string) for probe detail and admin status. */
export function balanceView(a: AccountBalance): Record<string, unknown> {
  return {
    publicKey: a.publicKey,
    role: a.role,
    stroops: a.stroops?.toString() ?? null,
    minStroops: a.minStroops.toString(),
    runwayHours: a.runwayHours,
    ...(a.estimated ? { estimated: true } : {}),
    checkedAt: a.checkedAt,
    ...(a.error ? { error: a.error } : {}),
  };
}
