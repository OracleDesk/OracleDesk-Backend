import { Account, Address, Contract, TransactionBuilder, scValToNative, xdr, rpc } from '@stellar/stellar-sdk';
import { TraceAuditStatus } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { prisma as defaultPrisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { config } from '../config';
import { CONTRACTS } from '../config/contracts';
import { agentSigner, readClients, rpcServer } from './stellar/clients';
import { sha256Hex } from '../utils/hash.util';
import { fetchIpfsBytes } from './ipfs.service';
import { AlertService } from './alerts.service';
import { pauseAgent as defaultPauseAgent } from './agent-controls.service';
import {
  traceAttestationMessage,
  verifyTraceSignatureLocal,
  type ChainTraceAction,
} from '../lib/trace-signing';
import {
  traceCount,
  marketTraceCount,
  marketTraceAt,
  getOnChainTraceOrNull,
  ArchivedEntryError,
} from './chain.service';

export { TraceAuditStatus };

export const TraceVerdictKind = {
  VALID: 'VALID',
  HASH_MISMATCH: 'HASH_MISMATCH',
  FLAGGED: 'FLAGGED',
  AGENT_REVOKED_AFTER: 'AGENT_REVOKED_AFTER',
  UNKNOWN: 'UNKNOWN',
} as const;

export type TraceVerdictKind = (typeof TraceVerdictKind)[keyof typeof TraceVerdictKind];

export interface ParsedTraceVerdict {
  kind: TraceVerdictKind;
  reason?: string | null;
  effectiveFrom?: bigint | null;
}

export interface TraceFlagEntry {
  active: boolean;
  reason: string;
  flaggedAt: bigint;
  historyIndex: number;
}

export interface RegistryAgentInfo {
  registered: boolean;
  revoked?: boolean;
  effectiveFrom?: bigint | null;
  reason?: string | null;
}

export interface RegistryReader {
  traceCount(): Promise<bigint>;
  marketTraceCount(marketId: bigint): Promise<bigint>;
  marketTraceAt(marketId: bigint, index: bigint): Promise<bigint>;
  getOnChainTraceOrNull(traceId: bigint): Promise<any | null>;
  /** Registry governance verdict: Valid | HashMismatch | Flagged(Symbol) | AgentRevokedAfter(u64) (#306). */
  traceVerdict?(traceId: bigint, receivedHash: Buffer): Promise<ParsedTraceVerdict>;
  /** Paginated flag history for a trace (<= 16 entries, #306). */
  traceFlags?(traceId: bigint, start: number, limit: number): Promise<TraceFlagEntry[]>;
  /** Agent registration & revocation metadata (#306). */
  getAgent?(agent: string): Promise<RegistryAgentInfo | null>;
}

/**
 * Maps a Soroban `TraceVerdict` tagged union (either binding `{ tag, values }`
 * or raw `scValToNative` array/string form) into `ParsedTraceVerdict`.
 */
export function mapBindingVerdict(raw: unknown): ParsedTraceVerdict {
  if (raw === null || raw === undefined) {
    return { kind: TraceVerdictKind.UNKNOWN, reason: null, effectiveFrom: null };
  }

  // Unwrap Result<TraceVerdict, Error> if present
  if (typeof raw === 'object' && 'isOk' in raw && typeof (raw as { isOk: unknown }).isOk === 'function') {
    const r = raw as { isOk(): boolean; unwrap(): unknown };
    if (!r.isOk()) return { kind: TraceVerdictKind.UNKNOWN, reason: null, effectiveFrom: null };
    return mapBindingVerdict(r.unwrap());
  }

  let tag: string | null = null;
  let val: unknown;

  if (typeof raw === 'string') {
    tag = raw;
  } else if (Array.isArray(raw) && raw.length > 0) {
    tag = String(raw[0]);
    val = raw[1];
  } else if (typeof raw === 'object' && 'tag' in raw) {
    const obj = raw as { tag: unknown; values?: readonly unknown[] };
    tag = String(obj.tag);
    val = Array.isArray(obj.values) ? obj.values[0] : obj.values;
  }

  switch (tag) {
    case 'Valid':
    case 'VALID':
      return { kind: TraceVerdictKind.VALID, reason: null, effectiveFrom: null };
    case 'HashMismatch':
    case 'HASH_MISMATCH':
      return { kind: TraceVerdictKind.HASH_MISMATCH, reason: null, effectiveFrom: null };
    case 'Flagged':
    case 'FLAGGED':
      return {
        kind: TraceVerdictKind.FLAGGED,
        reason: val !== undefined && val !== null ? String(val) : null,
        effectiveFrom: null,
      };
    case 'AgentRevokedAfter':
    case 'AGENT_REVOKED_AFTER':
      return {
        kind: TraceVerdictKind.AGENT_REVOKED_AFTER,
        reason: null,
        effectiveFrom: val !== undefined && val !== null ? BigInt(val as bigint | number | string) : null,
      };
    default:
      return { kind: TraceVerdictKind.UNKNOWN, reason: null, effectiveFrom: null };
  }
}

async function simulateRegistryCall(fn: string, args: xdr.ScVal[]): Promise<unknown> {
  const source = new Account(agentSigner().publicKey as string, '0');
  const op = new Contract(CONTRACTS.reasoningRegistry).call(fn, ...args);
  const tx = new TransactionBuilder(source, { fee: '100', networkPassphrase: config.STELLAR_NETWORK_PASSPHRASE })
    .addOperation(op)
    .setTimeout(0)
    .build();
  const sim = (await rpcServer.simulateTransaction(tx)) as rpc.Api.SimulateTransactionResponse;
  if (sim && typeof sim === 'object' && 'error' in sim && sim.error) {
    throw new Error(`reasoningRegistry.${fn} simulation failed: ${String(sim.error)}`);
  }
  const retval = (sim as { result?: { retval?: xdr.ScVal } }).result?.retval;
  return retval ? scValToNative(retval) : null;
}

function parseFlagEntries(raw: unknown, start: number): TraceFlagEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries: TraceFlagEntry[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i] as Record<string, unknown> | null;
    if (!item || typeof item !== 'object') continue;
    entries.push({
      active: Boolean(item.active ?? item.flagged ?? true),
      reason: String(item.reason ?? ''),
      flaggedAt: BigInt((item.flagged_at ?? item.flaggedAt ?? item.timestamp ?? 0) as bigint | number | string),
      historyIndex: typeof item.history_index === 'number'
        ? item.history_index
        : typeof item.historyIndex === 'number'
          ? item.historyIndex
          : start + i,
    });
  }
  return entries;
}

async function defaultTraceVerdict(traceId: bigint, receivedHash: Buffer): Promise<ParsedTraceVerdict> {
  const client = readClients.reasoningRegistry() as unknown as Record<string, ((args: unknown) => Promise<{ result: unknown }>) | undefined>;
  if (typeof client.trace_verdict === 'function') {
    const tx = await client.trace_verdict({ trace_id: traceId, received_hash: receivedHash });
    return mapBindingVerdict(tx.result);
  }
  const native = await simulateRegistryCall('trace_verdict', [
    xdr.ScVal.scvU64(xdr.Uint64.fromString(traceId.toString())),
    xdr.ScVal.scvBytes(receivedHash),
  ]);
  return mapBindingVerdict(native);
}

async function defaultTraceFlags(traceId: bigint, start: number, limit: number): Promise<TraceFlagEntry[]> {
  const client = readClients.reasoningRegistry() as unknown as Record<string, ((args: unknown) => Promise<{ result: unknown }>) | undefined>;
  if (typeof client.trace_flags === 'function') {
    const tx = await client.trace_flags({ trace_id: traceId, start, limit });
    const res = tx.result as { isOk?: () => boolean; unwrap?: () => unknown };
    const unwrapped = res && typeof res.isOk === 'function' ? (res.isOk() ? res.unwrap!() : []) : res;
    return parseFlagEntries(unwrapped, start);
  }
  const native = await simulateRegistryCall('trace_flags', [
    xdr.ScVal.scvU64(xdr.Uint64.fromString(traceId.toString())),
    xdr.ScVal.scvU32(start),
    xdr.ScVal.scvU32(limit),
  ]);
  return parseFlagEntries(native, start);
}

async function defaultGetAgent(agent: string): Promise<RegistryAgentInfo | null> {
  const client = readClients.reasoningRegistry() as unknown as Record<string, ((args: unknown) => Promise<{ result: unknown }>) | undefined>;
  let native: unknown;
  if (typeof client.get_agent === 'function') {
    const tx = await client.get_agent({ agent });
    const res = tx.result as { isOk?: () => boolean; unwrap?: () => unknown };
    native = res && typeof res.isOk === 'function' ? (res.isOk() ? res.unwrap!() : null) : res;
  } else {
    native = await simulateRegistryCall('get_agent', [new Address(agent).toScVal()]);
  }
  if (!native || typeof native !== 'object') return null;
  const rec = native as Record<string, unknown>;
  const eff = rec.revoked_from ?? rec.effective_from ?? rec.effectiveFrom ?? null;
  return {
    registered: rec.registered !== undefined ? Boolean(rec.registered) : true,
    revoked: Boolean(rec.revoked ?? eff !== null),
    effectiveFrom: eff !== null && eff !== undefined ? BigInt(eff as bigint | number | string) : null,
    reason: rec.reason !== undefined && rec.reason !== null ? String(rec.reason) : null,
  };
}

export const defaultRegistryReader: RegistryReader = {
  traceCount,
  marketTraceCount,
  marketTraceAt,
  getOnChainTraceOrNull,
  traceVerdict: defaultTraceVerdict,
  traceFlags: defaultTraceFlags,
  getAgent: defaultGetAgent,
};

/** Formats stored verdict columns for API list/detail responses (#306). */
export function formatTraceVerdict(row: {
  verdict?: string | null;
  verdictReason?: string | null;
  verdictEffectiveFrom?: bigint | string | null;
  verdictCheckedAt?: Date | null;
}) {
  return {
    kind: (row.verdict ?? TraceVerdictKind.UNKNOWN) as TraceVerdictKind,
    reason: row.verdictReason ?? null,
    effectiveFrom:
      row.verdictEffectiveFrom !== null && row.verdictEffectiveFrom !== undefined
        ? row.verdictEffectiveFrom.toString()
        : null,
    checkedAt: row.verdictCheckedAt ?? null,
  };
}

export interface ClassifyInput {
  onChain: {
    market_id: bigint;
    agent: string;
    action: string;
    trace_hash: Buffer | string;
    ipfs_cid: string;
    published_at?: bigint;
  } | null;
  db: {
    id: string;
    marketId: string;
    onChainTraceId: bigint | null;
    traceHash: string;
    ipfsCid: string;
    market?: { onChainMarketId: bigint | null } | null;
  } | null;
  dbMarket?: { id: string; onChainMarketId: bigint | null } | null;
  fetched: { bytes: Buffer } | { error: string } | null;
  knownAgents: Set<string>;
  isArchived?: boolean;
}

export interface ClassifyResult {
  status: TraceAuditStatus;
  detail?: Record<string, unknown>;
  computedHash?: string;
  onChainHash?: string;
}

/**
 * Classifies an attested trace signature (#273):
 * - Missing signature on legacy pre-cutover traces -> `UNSIGNED`
 * - Local Ed25519 verification failure or `ed25519_verify` contract trap -> `SIGNATURE_INVALID`
 * - Key bound to a foreign agent (`verify_trace_signature` returning `false`) -> `FOREIGN_AGENT`
 */
export function classifyTraceSignature(input: {
  signatureBase64?: string | null;
  signingKeyHex?: string | null;
  networkPassphrase?: string;
  registry?: string;
  agent: string;
  marketId: bigint;
  action: ChainTraceAction;
  traceHashHex: string;
  onChainVerify?: { ok: true; value: boolean } | { ok: false; trapped: boolean; error?: string };
}): { status: 'VERIFIED' | 'UNSIGNED' | 'SIGNATURE_INVALID' | 'FOREIGN_AGENT'; detail?: Record<string, unknown> } {
  if (!input.signatureBase64 || !input.signingKeyHex) {
    return { status: 'UNSIGNED', detail: { reason: 'No detached Ed25519 signature recorded (pre-cutover trace)' } };
  }

  const sigBytes = Buffer.from(input.signatureBase64, 'base64');
  const hashBytes = Buffer.from(input.traceHashHex.replace(/^0x/, ''), 'hex');
  const msg = traceAttestationMessage({
    networkPassphrase: input.networkPassphrase ?? config.STELLAR_NETWORK_PASSPHRASE,
    registry: input.registry ?? CONTRACTS.reasoningRegistry,
    agent: input.agent,
    marketId: input.marketId,
    action: input.action,
    traceHash: hashBytes,
  });

  if (!verifyTraceSignatureLocal(input.signingKeyHex.trim(), msg, sigBytes)) {
    return { status: 'SIGNATURE_INVALID', detail: { reason: 'Local Ed25519 verification failed', signingKey: input.signingKeyHex.trim() } };
  }

  if (input.onChainVerify) {
    if (!input.onChainVerify.ok) {
      if (input.onChainVerify.trapped) {
        return {
          status: 'SIGNATURE_INVALID',
          detail: { reason: 'verify_trace_signature trapped in ed25519_verify', error: input.onChainVerify.error },
        };
      }
    } else if (input.onChainVerify.value === false) {
      return {
        status: 'FOREIGN_AGENT',
        detail: { reason: 'Signing key is bound to a different agent on-chain', signingKey: input.signingKeyHex.trim() },
      };
    }
  }

  return { status: 'VERIFIED' };
}

/**
 * Pure classification function.
 * Evaluates an on-chain record against DB state, fetched content, and known agents.
 */
export function classify(input: ClassifyInput): ClassifyResult {
  const { onChain, db, dbMarket, fetched, knownAgents, isArchived } = input;

  if (!onChain) {
    if (isArchived) {
      return { status: TraceAuditStatus.ARCHIVED, detail: { reason: 'Entry archived on-chain' } };
    }
    return { status: TraceAuditStatus.NOT_ON_CHAIN, detail: { reason: 'TraceNotFound on-chain' } };
  }

  const onChainHash = Buffer.isBuffer(onChain.trace_hash)
    ? onChain.trace_hash.toString('hex').toLowerCase()
    : String(onChain.trace_hash).toLowerCase();

  const agentUpper = onChain.agent.toUpperCase();
  const isKnownAgent = Array.from(knownAgents).some((k) => k.toUpperCase() === agentUpper);

  if (!db) {
    if (!isKnownAgent) {
      return {
        status: TraceAuditStatus.FOREIGN_AGENT,
        onChainHash,
        detail: { agent: onChain.agent, marketId: onChain.market_id.toString() },
      };
    }
    return {
      status: TraceAuditStatus.UNKNOWN_TO_BACKEND,
      onChainHash,
      detail: { agent: onChain.agent, marketId: onChain.market_id.toString() },
    };
  }

  // Verify market assignment
  const dbMarketOnChainId = db.market?.onChainMarketId ?? dbMarket?.onChainMarketId;
  if (dbMarketOnChainId !== undefined && dbMarketOnChainId !== null && dbMarketOnChainId !== onChain.market_id) {
    return {
      status: TraceAuditStatus.WRONG_MARKET,
      onChainHash,
      detail: {
        expectedMarketId: onChain.market_id.toString(),
        actualMarketId: dbMarketOnChainId.toString(),
      },
    };
  }

  // Check fetched content
  let computedHash: string | undefined;
  if (fetched) {
    if ('error' in fetched) {
      return {
        status: TraceAuditStatus.UNAVAILABLE,
        onChainHash,
        detail: { error: fetched.error },
      };
    }
    computedHash = sha256Hex(fetched.bytes).toLowerCase();
    if (computedHash !== onChainHash) {
      return {
        status: TraceAuditStatus.HASH_MISMATCH,
        onChainHash,
        computedHash,
        detail: { onChainHash, computedHash, ipfsCid: onChain.ipfs_cid },
      };
    }
  }

  // Unlinked in DB: matched by hash or market, but onChainTraceId is null
  if (db.onChainTraceId === null) {
    return {
      status: TraceAuditStatus.UNLINKED_IN_DB,
      onChainHash,
      computedHash,
      detail: { traceId: db.id, storedHash: db.traceHash },
    };
  }

  // Hash disagreements between DB and on-chain (even if verified against fetched bytes)
  const detail: Record<string, unknown> = {};
  if (db.traceHash.toLowerCase() !== onChainHash) {
    detail.dbHashMismatch = { dbHash: db.traceHash, onChainHash };
  }
  if (db.ipfsCid !== onChain.ipfs_cid) {
    detail.cidMismatch = { dbCid: db.ipfsCid, onChainCid: onChain.ipfs_cid };
  }

  return {
    status: TraceAuditStatus.VERIFIED,
    onChainHash,
    computedHash,
    detail: Object.keys(detail).length > 0 ? detail : undefined,
  };
}

export interface RpcCallsByCategory {
  discovery: number;
  hashAudit: number;
  verdict: number;
  flags: number;
}

export interface TraceAuditOptions {
  runId?: string;
  reader?: RegistryReader;
  prisma?: any;
  maxRpc?: number;
  verdictRpcShare?: number;
  maxFetches?: number;
  maxBytes?: number;
  recheckHours?: number;
  fetchBytesFn?: (cid: string, opts?: { maxBytes?: number }) => Promise<Buffer>;
  alerts?: AlertService;
  pauseAgentFn?: typeof defaultPauseAgent;
  knownAgentsOverride?: Set<string>;
}

export interface TraceAuditSummary {
  runId: string;
  totalAudited: number;
  counts: Record<string, number>;
  relinked: number;
  rpcCalls: number;
  rpcCallsByCategory: RpcCallsByCategory;
  verdictsChecked: number;
  verdictsChanged: number;
  fetches: number;
}

function collectKnownAgents(override?: Set<string>): Set<string> {
  if (override) return new Set(Array.from(override).map((a) => a.toUpperCase()));
  const knownAgents = new Set<string>();
  const deployedAgent = (CONTRACTS as Record<string, string | undefined>).deployedAgent;
  if (deployedAgent) knownAgents.add(deployedAgent.toUpperCase());
  try {
    const signer = agentSigner();
    if (signer?.publicKey) knownAgents.add(signer.publicKey.toUpperCase());
  } catch {
    // In test/dry-run without configured key, ignore
  }
  return knownAgents;
}

interface VerdictCheckTraceRow {
  id: string;
  onChainTraceId: bigint;
  traceHash: string | null;
  agentWallet?: string | null;
  verdict?: string | null;
  verdictReason?: string | null;
  verdictEffectiveFrom?: bigint | null;
  verdictVersion?: number | null;
}

/**
 * Queries `trace_verdict` (and `trace_flags` if FLAGGED), updates verdict
 * columns (incrementing `verdictVersion` only when the verdict changes),
 * pauses agents on backend-agent revocation, and sends CRITICAL alerts
 * deduplicated by `(traceId, verdictVersion)`.
 */
async function evaluateAndPersistVerdict(
  trace: VerdictCheckTraceRow,
  opts: {
    reader: RegistryReader;
    prisma: any;
    knownAgents: Set<string>;
    rpcTracker: RpcCallsByCategory;
    remainingVerdictRpc: () => number;
    alerts?: AlertService;
    pauseAgentFn?: typeof defaultPauseAgent;
    traceAgentFallback?: string | null;
  },
): Promise<{ verdict: ParsedTraceVerdict; changed: boolean } | null> {
  if (!opts.reader.traceVerdict || !trace.traceHash || opts.remainingVerdictRpc() <= 0) {
    return null;
  }

  let verdict: ParsedTraceVerdict;
  try {
    const hashBuf = Buffer.from(trace.traceHash.replace(/^0x/, ''), 'hex');
    verdict = await opts.reader.traceVerdict(trace.onChainTraceId, hashBuf);
    opts.rpcTracker.verdict++;
  } catch (err) {
    logger.warn(
      { traceId: trace.id, onChainTraceId: trace.onChainTraceId.toString(), err: err instanceof Error ? err.message : String(err) },
      'trace verdict: RPC call failed',
    );
    return null;
  }

  // If Flagged, page trace_flags (<= 16 entries, one call) and upsert trace_flag_events
  if (
    verdict.kind === TraceVerdictKind.FLAGGED &&
    opts.reader.traceFlags &&
    opts.remainingVerdictRpc() > 0 &&
    opts.prisma.traceFlagEvent?.upsert
  ) {
    try {
      const entries = await opts.reader.traceFlags(trace.onChainTraceId, 0, 16);
      opts.rpcTracker.flags++;
      for (const entry of entries) {
        await opts.prisma.traceFlagEvent.upsert({
          where: {
            onChainTraceId_historyIndex: {
              onChainTraceId: trace.onChainTraceId,
              historyIndex: entry.historyIndex,
            },
          },
          create: {
            onChainTraceId: trace.onChainTraceId,
            active: entry.active,
            reason: entry.reason,
            flaggedAt: entry.flaggedAt,
            historyIndex: entry.historyIndex,
          },
          update: {
            active: entry.active,
            reason: entry.reason,
            flaggedAt: entry.flaggedAt,
          },
        });
      }
    } catch (err) {
      logger.warn(
        { traceId: trace.id, onChainTraceId: trace.onChainTraceId.toString(), err: err instanceof Error ? err.message : String(err) },
        'trace verdict: trace_flags fetch failed',
      );
    }
  }

  const prevKind = trace.verdict ?? TraceVerdictKind.UNKNOWN;
  const prevReason = trace.verdictReason ?? null;
  const prevEff = trace.verdictEffectiveFrom ?? null;
  const nextReason = verdict.reason ?? null;
  const nextEff = verdict.effectiveFrom ?? null;

  const changed = prevKind !== verdict.kind || prevReason !== nextReason || prevEff !== nextEff;
  const currentVersion = trace.verdictVersion ?? 0;
  const nextVersion = changed ? currentVersion + 1 : currentVersion;
  const now = new Date();

  await opts.prisma.reasoningTrace.update({
    where: { id: trace.id },
    data: {
      verdict: verdict.kind,
      verdictReason: nextReason,
      verdictEffectiveFrom: nextEff,
      verdictCheckedAt: now,
      verdictVersion: nextVersion,
      verified: verdict.kind === TraceVerdictKind.VALID,
    },
  });

  // Alert & auto-pause when the backend's own agent trace is FLAGGED or AGENT_REVOKED_AFTER
  const traceAgent = (trace.agentWallet ?? opts.traceAgentFallback ?? '').toUpperCase();
  const isBackendAgent = Boolean(traceAgent) && opts.knownAgents.has(traceAgent);

  if (
    isBackendAgent &&
    (verdict.kind === TraceVerdictKind.FLAGGED || verdict.kind === TraceVerdictKind.AGENT_REVOKED_AFTER)
  ) {
    let agentPaused = false;
    if (verdict.kind === TraceVerdictKind.AGENT_REVOKED_AFTER) {
      const pauseFn = opts.pauseAgentFn ?? defaultPauseAgent;
      try {
        await pauseFn('ALL', {
          source: 'operator',
          actor: 'system',
          reason: 'agent revoked in registry',
        });
        agentPaused = true;
      } catch (err) {
        logger.error({ err, traceId: trace.id }, 'trace verdict: failed to pause agents on revocation');
      }
    }

    const alerts = opts.alerts ?? new AlertService();
    const subjectId = `trace_verdict:${trace.id}:v${nextVersion}`;
    await alerts
      .send(subjectId, {
        kind: 'trace_verdict',
        level: 'CRITICAL',
        title:
          verdict.kind === TraceVerdictKind.AGENT_REVOKED_AFTER
            ? `Backend agent revoked in reasoning registry (trace ${trace.onChainTraceId.toString()})`
            : `Backend reasoning trace ${trace.onChainTraceId.toString()} was FLAGGED in registry`,
        traceId: trace.id,
        onChainTraceId: trace.onChainTraceId.toString(),
        agent: trace.agentWallet ?? opts.traceAgentFallback ?? '',
        verdict: verdict.kind,
        reason: nextReason,
        effectiveFrom: nextEff !== null ? nextEff.toString() : null,
        verdictVersion: nextVersion,
        agentPaused,
        detail:
          verdict.kind === TraceVerdictKind.AGENT_REVOKED_AFTER
            ? `Agent was revoked effective from ${nextEff?.toString() ?? 'unknown'}; all agent scopes have been paused.`
            : `Registry admin flagged trace with reason: ${nextReason ?? 'unspecified'}.`,
      })
      .catch((err) => {
        logger.warn({ traceId: trace.id, err: err instanceof Error ? err.message : String(err) }, 'trace verdict: alert send failed');
      });
  }

  return { verdict, changed };
}

export async function runTraceAudit(opts: TraceAuditOptions = {}): Promise<TraceAuditSummary> {
  const prisma = opts.prisma ?? defaultPrisma;
  const reader = opts.reader ?? defaultRegistryReader;
  const maxRpc = opts.maxRpc ?? config.TRACE_AUDIT_MAX_RPC;
  const verdictShare = opts.verdictRpcShare ?? config.TRACE_AUDIT_VERDICT_RPC_SHARE;
  const hasVerdictReader = typeof reader.traceVerdict === 'function';
  const verdictBudget = hasVerdictReader ? Math.floor(maxRpc * verdictShare) : 0;
  const hashBudget = Math.max(1, maxRpc - verdictBudget);
  const maxFetches = opts.maxFetches ?? config.TRACE_AUDIT_MAX_FETCHES;
  const maxBytes = opts.maxBytes ?? config.TRACE_AUDIT_MAX_BYTES;
  const recheckHours = opts.recheckHours ?? config.TRACE_AUDIT_RECHECK_HOURS;
  const fetchFn = opts.fetchBytesFn ?? ((cid) => fetchIpfsBytes(cid));

  const rpcTracker: RpcCallsByCategory = { discovery: 0, hashAudit: 0, verdict: 0, flags: 0 };
  const totalRpc = () => rpcTracker.discovery + rpcTracker.hashAudit + rpcTracker.verdict + rpcTracker.flags;
  const hashRpcUsed = () => rpcTracker.discovery + rpcTracker.hashAudit;
  const verdictRpcRemaining = () => Math.max(0, Math.min(verdictBudget - (rpcTracker.verdict + rpcTracker.flags), maxRpc - totalRpc()));

  let fetches = 0;
  let relinked = 0;
  let verdictsChecked = 0;
  let verdictsChanged = 0;

  const runId = opts.runId ?? uuidv4();
  await prisma.traceAuditRun.create({
    data: { id: runId, startedAt: new Date() },
  });

  const knownAgents = collectKnownAgents(opts.knownAgentsOverride);

  const counts: Record<string, number> = {
    VERIFIED: 0,
    HASH_MISMATCH: 0,
    UNAVAILABLE: 0,
    UNKNOWN_TO_BACKEND: 0,
    WRONG_MARKET: 0,
    UNLINKED_IN_DB: 0,
    NOT_ON_CHAIN: 0,
    FOREIGN_AGENT: 0,
    ARCHIVED: 0,
  };

  // Collect trace IDs to inspect
  const candidateIds = new Set<bigint>();

  // A. Per-market pass: audit known markets with onChainMarketId
  const markets = await prisma.market.findMany({
    where: { onChainMarketId: { not: null } },
    select: { id: true, onChainMarketId: true },
  });

  for (const m of markets) {
    if (hashRpcUsed() >= hashBudget) break;
    if (m.onChainMarketId === null) continue;
    try {
      const count = await reader.marketTraceCount(m.onChainMarketId);
      rpcTracker.discovery++;
      for (let i = 0n; i < count; i++) {
        if (hashRpcUsed() >= hashBudget) break;
        const tid = await reader.marketTraceAt(m.onChainMarketId, i);
        rpcTracker.discovery++;
        candidateIds.add(tid);
      }
    } catch (err) {
      logger.warn({ marketId: m.id, err }, 'Failed reading market traces from registry');
    }
  }

  // B. Global pass: walk from last cursor up to traceCount() - 1
  let nextCursor: bigint | null = null;
  if (hashRpcUsed() < hashBudget) {
    try {
      const totalCount = await reader.traceCount();
      rpcTracker.discovery++;
      const lastRun = await prisma.traceAuditRun.findFirst({
        where: { finishedAt: { not: null }, cursorTraceId: { not: null } },
        orderBy: { startedAt: 'desc' },
      });
      const startCursor = lastRun?.cursorTraceId ?? 0n;
      let cur = startCursor;
      while (cur < totalCount && hashRpcUsed() + candidateIds.size < hashBudget) {
        candidateIds.add(cur);
        cur++;
      }
      nextCursor = cur;
    } catch (err) {
      logger.warn({ err }, 'Failed reading global trace count from registry');
    }
  }

  // C. Re-audit pass: non-VERIFIED or stale records
  const staleThreshold = new Date(Date.now() - recheckHours * 3600 * 1000);
  const staleAudits = await prisma.traceAudit.findMany({
    where: {
      OR: [
        { status: { not: TraceAuditStatus.VERIFIED } },
        { checkedAt: { lt: staleThreshold } },
      ],
      onChainTraceId: { not: null },
    },
    take: 50,
    select: { onChainTraceId: true },
  });
  for (const a of staleAudits) {
    if (a.onChainTraceId !== null) candidateIds.add(a.onChainTraceId);
  }

  // D. DB pass: DB traces with onChainTraceId not in candidate list
  const dbTracesWithOnChain = await prisma.reasoningTrace.findMany({
    where: { onChainTraceId: { not: null } },
    select: { onChainTraceId: true },
    take: 50,
  });
  for (const t of dbTracesWithOnChain) {
    if (t.onChainTraceId !== null) candidateIds.add(t.onChainTraceId);
  }

  let totalAudited = 0;
  const verdictEvaluatedIds = new Set<string>();

  for (const onChainTraceId of candidateIds) {
    if (hashRpcUsed() >= hashBudget) break;

    let onChain: any = null;
    let isArchived = false;

    try {
      onChain = await reader.getOnChainTraceOrNull(onChainTraceId);
      rpcTracker.hashAudit++;
    } catch (err: any) {
      if (err instanceof ArchivedEntryError || err?.code === 'ARCHIVED_ENTRY') {
        isArchived = true;
      } else {
        logger.warn({ onChainTraceId: onChainTraceId.toString(), err }, 'Error reading on-chain trace');
      }
    }

    // Lookup matching DB trace
    let dbTrace = await prisma.reasoningTrace.findUnique({
      where: { onChainTraceId },
      include: { market: { select: { onChainMarketId: true } } },
    });

    if (!dbTrace && onChain) {
      const hexHash = Buffer.isBuffer(onChain.trace_hash)
        ? onChain.trace_hash.toString('hex').toLowerCase()
        : String(onChain.trace_hash).toLowerCase();

      const matchingTraces = await prisma.reasoningTrace.findMany({
        where: { traceHash: hexHash },
        include: { market: { select: { onChainMarketId: true } } },
      });
      dbTrace =
        matchingTraces.find((t: any) => t.market?.onChainMarketId === onChain.market_id) ||
        matchingTraces[0] ||
        null;
    }

    let dbMarket: any = null;
    if (onChain) {
      dbMarket = await prisma.market.findFirst({
        where: { onChainMarketId: onChain.market_id },
        select: { id: true, onChainMarketId: true },
      });
    }

    // Content fetch if available and budget permits
    let fetched: { bytes: Buffer } | { error: string } | null = null;
    if (onChain?.ipfs_cid) {
      if (fetches < maxFetches) {
        try {
          const bytes = await fetchFn(onChain.ipfs_cid, { maxBytes });
          fetches++;
          fetched = { bytes };
        } catch (err: any) {
          fetches++;
          fetched = { error: err.message || String(err) };
        }
      } else {
        fetched = { error: 'Fetch budget exceeded' };
      }
    }

    const classified = classify({
      onChain,
      db: dbTrace,
      dbMarket,
      fetched,
      knownAgents,
      isArchived,
    });

    counts[classified.status] = (counts[classified.status] || 0) + 1;
    totalAudited++;

    // Safe relink for UNLINKED_IN_DB
    if (
      classified.status === TraceAuditStatus.UNLINKED_IN_DB &&
      dbTrace &&
      dbTrace.onChainTraceId === null &&
      onChain
    ) {
      let publishTxHash: string | null = null;
      try {
        const ev = await prisma.chainEvent.findFirst({
          where: {
            eventName: 'TracePublished',
            params: { path: ['trace_id'], equals: onChainTraceId.toString() },
          },
          select: { txHash: true },
        });
        if (ev?.txHash) publishTxHash = ev.txHash;
      } catch {
        // ignore JSON path error if unsupported
      }

      await prisma.reasoningTrace.update({
        where: { id: dbTrace.id },
        data: {
          onChainTraceId,
          ...(publishTxHash ? { publishTxHash } : {}),
          lastAuditStatus: classified.status,
          lastAuditedAt: new Date(),
        },
      });
      relinked++;
    } else if (dbTrace) {
      await prisma.reasoningTrace.update({
        where: { id: dbTrace.id },
        data: {
          lastAuditStatus: classified.status,
          lastAuditedAt: new Date(),
          // When verdict reader is absent (legacy mock), fall back to hash verification;
          // when present, verified is controlled strictly by trace_verdict === VALID (#306).
          verified: hasVerdictReader
            ? classified.status === TraceAuditStatus.VERIFIED && dbTrace.verdict === TraceVerdictKind.VALID
            : classified.status === TraceAuditStatus.VERIFIED,
        },
      });

      // After classifying VERIFIED, evaluate trace_verdict against the registry (#306)
      if (classified.status === TraceAuditStatus.VERIFIED && hasVerdictReader && verdictRpcRemaining() > 0) {
        const res = await evaluateAndPersistVerdict(
          {
            id: dbTrace.id,
            onChainTraceId,
            traceHash: dbTrace.traceHash,
            agentWallet: dbTrace.agentWallet,
            verdict: dbTrace.verdict,
            verdictReason: dbTrace.verdictReason,
            verdictEffectiveFrom: dbTrace.verdictEffectiveFrom,
            verdictVersion: dbTrace.verdictVersion,
          },
          {
            reader,
            prisma,
            knownAgents,
            rpcTracker,
            remainingVerdictRpc: verdictRpcRemaining,
            alerts: opts.alerts,
            pauseAgentFn: opts.pauseAgentFn,
            traceAgentFallback: onChain?.agent ?? null,
          },
        );
        if (res) {
          verdictEvaluatedIds.add(dbTrace.id);
          verdictsChecked++;
          if (res.changed) verdictsChanged++;
        }
      }
    }

    // Persist audit result
    await prisma.traceAudit.upsert({
      where: {
        onChainTraceId_runId: {
          onChainTraceId,
          runId,
        },
      },
      create: {
        runId,
        onChainTraceId,
        traceId: dbTrace?.id ?? null,
        onChainMarketId: onChain?.market_id ?? null,
        agent: onChain?.agent ?? null,
        action: onChain?.action ?? null,
        ipfsCid: onChain?.ipfs_cid ?? null,
        onChainHash: classified.onChainHash ?? null,
        computedHash: classified.computedHash ?? null,
        status: classified.status,
        detail: classified.detail ? (classified.detail as any) : undefined,
      },
      update: {
        status: classified.status,
        detail: classified.detail ? (classified.detail as any) : undefined,
      },
    });
  }

  // E. Prioritised verdict pass over remaining verdict budget (#306):
  // (a) non-VALID traces, (b) traces of revoked agents, (c) oldest verdictCheckedAt.
  if (hasVerdictReader && verdictRpcRemaining() > 0) {
    const extra = await runPrioritisedVerdictPass({
      prisma,
      reader,
      knownAgents,
      rpcTracker,
      remainingVerdictRpc: verdictRpcRemaining,
      skipTraceIds: verdictEvaluatedIds,
      includeOldest: true,
      alerts: opts.alerts,
      pauseAgentFn: opts.pauseAgentFn,
    });
    verdictsChecked += extra.checked;
    verdictsChanged += extra.changed;
  }

  // Also audit any DB traces that have no onChainTraceId to catch NOT_ON_CHAIN / dry-run states
  const unlinkedTraces = await prisma.reasoningTrace.findMany({
    where: { onChainTraceId: null, lastAuditStatus: null },
    take: 20,
    select: { id: true, traceHash: true, ipfsCid: true, marketId: true },
  });

  for (const t of unlinkedTraces) {
    const classified = classify({
      onChain: null,
      db: t as any,
      fetched: null,
      knownAgents,
      isArchived: false,
    });

    counts[classified.status] = (counts[classified.status] || 0) + 1;
    totalAudited++;

    await prisma.traceAudit.create({
      data: {
        runId,
        onChainTraceId: null,
        traceId: t.id,
        status: classified.status,
        detail: classified.detail ? (classified.detail as any) : undefined,
      },
    });

    await prisma.reasoningTrace.update({
      where: { id: t.id },
      data: {
        lastAuditStatus: classified.status,
        lastAuditedAt: new Date(),
        verified: false,
      },
    });
  }

  const rpcCalls = totalRpc();
  const finishedAt = new Date();
  await prisma.traceAuditRun.update({
    where: { id: runId },
    data: {
      finishedAt,
      cursorTraceId: nextCursor,
      stats: {
        totalAudited,
        counts,
        relinked,
        rpcCalls,
        rpcCallsByCategory: rpcTracker,
        verdictsChecked,
        verdictsChanged,
        fetches,
      },
    },
  });

  return {
    runId,
    totalAudited,
    counts,
    relinked,
    rpcCalls,
    rpcCallsByCategory: rpcTracker,
    verdictsChecked,
    verdictsChanged,
    fetches,
  };
}

async function runPrioritisedVerdictPass(opts: {
  prisma: any;
  reader: RegistryReader;
  knownAgents: Set<string>;
  rpcTracker: RpcCallsByCategory;
  remainingVerdictRpc: () => number;
  skipTraceIds: Set<string>;
  includeOldest: boolean;
  alerts?: AlertService;
  pauseAgentFn?: typeof defaultPauseAgent;
}): Promise<{ checked: number; changed: number }> {
  let checked = 0;
  let changed = 0;
  const seen = new Set<string>(opts.skipTraceIds);

  const selectFields = {
    id: true,
    onChainTraceId: true,
    traceHash: true,
    agentWallet: true,
    verdict: true,
    verdictReason: true,
    verdictEffectiveFrom: true,
    verdictVersion: true,
  };

  const processList = async (rows: VerdictCheckTraceRow[]) => {
    for (const row of rows) {
      if (opts.remainingVerdictRpc() <= 0) break;
      if (seen.has(row.id) || row.onChainTraceId === null || !row.traceHash) continue;
      seen.add(row.id);
      const res = await evaluateAndPersistVerdict(row, {
        reader: opts.reader,
        prisma: opts.prisma,
        knownAgents: opts.knownAgents,
        rpcTracker: opts.rpcTracker,
        remainingVerdictRpc: opts.remainingVerdictRpc,
        alerts: opts.alerts,
        pauseAgentFn: opts.pauseAgentFn,
      });
      if (res) {
        checked++;
        if (res.changed) changed++;
      }
    }
  };

  // Priority (a): traces with a non-VALID verdict
  if (opts.remainingVerdictRpc() > 0) {
    const nonValid = await opts.prisma.reasoningTrace.findMany({
      where: {
        onChainTraceId: { not: null },
        traceHash: { not: null },
        verdict: { not: TraceVerdictKind.VALID },
      },
      orderBy: { verdictCheckedAt: 'asc' },
      take: opts.remainingVerdictRpc(),
      select: selectFields,
    });
    await processList(nonValid);
  }

  // Priority (b): traces of agents in agent_revocations
  if (opts.remainingVerdictRpc() > 0 && opts.prisma.agentRevocation?.findMany) {
    const revocations: Array<{ agent: string }> = await opts.prisma.agentRevocation.findMany({
      select: { agent: true },
    });
    const revokedAgents = revocations.map((r) => r.agent);
    if (revokedAgents.length > 0) {
      const revokedTraces = await opts.prisma.reasoningTrace.findMany({
        where: {
          onChainTraceId: { not: null },
          traceHash: { not: null },
          agentWallet: { in: revokedAgents },
        },
        orderBy: { verdictCheckedAt: 'asc' },
        take: opts.remainingVerdictRpc(),
        select: selectFields,
      });
      await processList(revokedTraces);
    }
  }

  // Priority (c): oldest verdictCheckedAt (full audit only; fast lane skips this)
  if (opts.includeOldest && opts.remainingVerdictRpc() > 0) {
    const oldest = await opts.prisma.reasoningTrace.findMany({
      where: {
        onChainTraceId: { not: null },
        traceHash: { not: null },
      },
      orderBy: { verdictCheckedAt: 'asc' },
      take: opts.remainingVerdictRpc(),
      select: selectFields,
    });
    await processList(oldest);
  }

  return { checked, changed };
}

export interface VerdictRecheckOptions {
  maxRpc?: number;
  onChainTraceIds?: bigint[];
  reader?: RegistryReader;
  prisma?: any;
  alerts?: AlertService;
  pauseAgentFn?: typeof defaultPauseAgent;
  knownAgentsOverride?: Set<string>;
}

export interface VerdictRecheckSummary {
  checked: number;
  changed: number;
  rpcCalls: number;
  rpcCallsByCategory: RpcCallsByCategory;
}

/**
 * Fast-lane verdict re-check (#306):
 * - When `onChainTraceIds` is supplied (from indexer events), immediately re-checks those traces.
 * - Otherwise re-checks priority classes (a) non-VALID and (b) revoked-agent traces only,
 *   strictly within `maxRpc` (default `TRACE_VERDICT_MAX_RPC`).
 */
export async function runVerdictRecheck(opts: VerdictRecheckOptions = {}): Promise<VerdictRecheckSummary> {
  const prisma = opts.prisma ?? defaultPrisma;
  const reader = opts.reader ?? defaultRegistryReader;
  const maxRpc = opts.maxRpc ?? config.TRACE_VERDICT_MAX_RPC;
  const knownAgents = collectKnownAgents(opts.knownAgentsOverride);
  const rpcTracker: RpcCallsByCategory = { discovery: 0, hashAudit: 0, verdict: 0, flags: 0 };
  const remaining = () => Math.max(0, maxRpc - (rpcTracker.verdict + rpcTracker.flags));

  if (opts.onChainTraceIds && opts.onChainTraceIds.length > 0) {
    const rows = await prisma.reasoningTrace.findMany({
      where: {
        onChainTraceId: { in: opts.onChainTraceIds },
        traceHash: { not: null },
      },
      select: {
        id: true,
        onChainTraceId: true,
        traceHash: true,
        agentWallet: true,
        verdict: true,
        verdictReason: true,
        verdictEffectiveFrom: true,
        verdictVersion: true,
      },
    });
    let checked = 0;
    let changed = 0;
    for (const row of rows) {
      if (remaining() <= 0) break;
      const res = await evaluateAndPersistVerdict(row, {
        reader,
        prisma,
        knownAgents,
        rpcTracker,
        remainingVerdictRpc: remaining,
        alerts: opts.alerts,
        pauseAgentFn: opts.pauseAgentFn,
      });
      if (res) {
        checked++;
        if (res.changed) changed++;
      }
    }
    return { checked, changed, rpcCalls: rpcTracker.verdict + rpcTracker.flags, rpcCallsByCategory: rpcTracker };
  }

  const res = await runPrioritisedVerdictPass({
    prisma,
    reader,
    knownAgents,
    rpcTracker,
    remainingVerdictRpc: remaining,
    skipTraceIds: new Set(),
    includeOldest: false,
    alerts: opts.alerts,
    pauseAgentFn: opts.pauseAgentFn,
  });

  return {
    checked: res.checked,
    changed: res.changed,
    rpcCalls: rpcTracker.verdict + rpcTracker.flags,
    rpcCallsByCategory: rpcTracker,
  };
}

/** Non-blocking hook for indexer events (TraceFlagged, TraceUnflagged, AgentRevoked). */
export function scheduleVerdictRecheck(onChainTraceIds: bigint[], opts?: Omit<VerdictRecheckOptions, 'onChainTraceIds'>): void {
  if (onChainTraceIds.length === 0) return;
  setImmediate(() => {
    runVerdictRecheck({ ...opts, onChainTraceIds }).catch((err) => {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), count: onChainTraceIds.length },
        'trace verdict: scheduled recheck failed',
      );
    });
  });
}

// ─── Live verdict cache for copy-trade gate (#306) ──────────────────────────

const LIVE_VERDICT_CACHE_MS = 60_000;
const liveVerdictCache = new Map<string, { verdict: ParsedTraceVerdict; checkedAt: Date; expiresAt: number }>();

export function clearLiveVerdictCacheForTest(): void {
  liveVerdictCache.clear();
}

/**
 * Returns a fresh verdict for copy-trading (#306). When the stored check is
 * older than `COPY_TRADE_VERDICT_MAX_AGE_SECS`, re-reads `trace_verdict` live
 * from the registry (cached for 60 s) and updates stored columns on change.
 */
export async function getFreshTraceVerdict(
  trace: {
    id: string;
    onChainTraceId: bigint | null;
    traceHash: string | null;
    agentWallet?: string | null;
    verdict?: string | null;
    verdictReason?: string | null;
    verdictEffectiveFrom?: bigint | null;
    verdictCheckedAt?: Date | null;
    verdictVersion?: number | null;
  },
  opts: {
    reader?: RegistryReader;
    prisma?: any;
    maxAgeSecs?: number;
    now?: Date;
    alerts?: AlertService;
    pauseAgentFn?: typeof defaultPauseAgent;
  } = {},
): Promise<{
  kind: TraceVerdictKind;
  reason: string | null;
  effectiveFrom: string | null;
  checkedAt: Date | null;
  liveChecked: boolean;
}> {
  const now = opts.now ?? new Date();
  const maxAgeMs = (opts.maxAgeSecs ?? config.COPY_TRADE_VERDICT_MAX_AGE_SECS) * 1000;
  const storedFresh =
    trace.verdictCheckedAt !== null &&
    trace.verdictCheckedAt !== undefined &&
    now.getTime() - trace.verdictCheckedAt.getTime() <= maxAgeMs;

  if (storedFresh || trace.onChainTraceId === null || !trace.traceHash) {
    return {
      ...formatTraceVerdict(trace),
      liveChecked: false,
    };
  }

  const cacheKey = trace.onChainTraceId.toString();
  const cached = liveVerdictCache.get(cacheKey);
  if (cached && cached.expiresAt > now.getTime()) {
    return {
      kind: cached.verdict.kind,
      reason: cached.verdict.reason ?? null,
      effectiveFrom: cached.verdict.effectiveFrom !== null && cached.verdict.effectiveFrom !== undefined
        ? cached.verdict.effectiveFrom.toString()
        : null,
      checkedAt: cached.checkedAt,
      liveChecked: true,
    };
  }

  const reader = opts.reader ?? defaultRegistryReader;
  const prisma = opts.prisma ?? defaultPrisma;
  const rpcTracker: RpcCallsByCategory = { discovery: 0, hashAudit: 0, verdict: 0, flags: 0 };
  const evaluated = await evaluateAndPersistVerdict(
    {
      id: trace.id,
      onChainTraceId: trace.onChainTraceId,
      traceHash: trace.traceHash,
      agentWallet: trace.agentWallet,
      verdict: trace.verdict,
      verdictReason: trace.verdictReason,
      verdictEffectiveFrom: trace.verdictEffectiveFrom,
      verdictVersion: trace.verdictVersion,
    },
    {
      reader,
      prisma,
      knownAgents: collectKnownAgents(),
      rpcTracker,
      remainingVerdictRpc: () => 2,
      alerts: opts.alerts,
      pauseAgentFn: opts.pauseAgentFn,
    },
  );

  if (!evaluated) {
    return {
      ...formatTraceVerdict(trace),
      liveChecked: false,
    };
  }

  liveVerdictCache.set(cacheKey, {
    verdict: evaluated.verdict,
    checkedAt: now,
    expiresAt: now.getTime() + LIVE_VERDICT_CACHE_MS,
  });

  return {
    kind: evaluated.verdict.kind,
    reason: evaluated.verdict.reason ?? null,
    effectiveFrom:
      evaluated.verdict.effectiveFrom !== null && evaluated.verdict.effectiveFrom !== undefined
        ? evaluated.verdict.effectiveFrom.toString()
        : null,
    checkedAt: now,
    liveChecked: true,
  };
}
