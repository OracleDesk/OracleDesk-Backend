/**
 * Reasoning trace lifecycle after generation (#131):
 *   enqueue → pin the canonical JSON (traceHash = sha256(pinned bytes)) →
 *   wait for the market's on-chain id → reasoning_registry.publish_trace →
 *   confirmed by the indexer's TracePublished event → verified.
 * See src/jobs/trace-publication.worker.ts.
 */
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { config } from '../config';
import { AppError } from '../middlewares/error.middleware';
import { verifyTraceHash, sha256Hex } from '../utils/hash.util';
import { Prisma } from '@prisma/client';
import { fetchIpfsBytes } from './ipfs.service';
import { getOnChainTrace, printable } from './chain.service';
import { registerHandler, type ChainTransactionRow, type CompletionContext, type CompletionOutcome } from './stellar/outbox';
import { processPublication } from '../jobs/trace-publication.worker';
import type { TraceAction } from '../lib/trace-actions';
import { fetchVerifiedBytes, pinJson } from './ipfs.service';
import { publishTrace } from './chain.service';
import type { AgentScope } from './agent-controls.service';
import { agentSigner } from './stellar/clients';
import type { TraceVerification } from '../types';
import { TraceDocV1 } from '../schemas/trace';
import {
  sealTrace,
  openTrace,
  loadKeks,
  TracePublicPart,
  createKek,
} from './trace-crypto.service';
import crypto from 'node:crypto';

/**
 * Completion handler for `trace.publish` outbox rows (#35): links the landed
 * trace id even when the publication worker died between submitting and its
 * own confirm step. Idempotent: guarded on onChainTraceId still being null,
 * exactly like the indexer's TracePublished projection. Failures are left to
 * the publication worker's own retry state machine.
 */
export async function handleTracePublishOutcome(
  row: ChainTransactionRow,
  outcome: CompletionOutcome,
  ctx: CompletionContext,
): Promise<void> {
  const traceId = row.refId;
  if (!traceId || outcome.status !== 'SUCCESS') return;
  const onChainTraceId = BigInt(String(outcome.value ?? '0'));
  await ctx.tx.reasoningTrace.updateMany({
    where: { id: traceId, onChainTraceId: null },
    data: {
      onChainTraceId,
      publishTxHash: outcome.txHash ?? null,
      publishInnerTxHash: row.hash ?? outcome.txHash ?? null,
      verified: true,
    },
  });
  await ctx.tx.tracePublication.updateMany({
    where: { traceId, status: { in: ['AWAITING_MARKET', 'READY', 'SUBMITTED'] } },
    data: { status: 'CONFIRMED', confirmedAt: new Date(), lastError: null },
  });
}

registerHandler('trace.publish', handleTracePublishOutcome);

/**
 * Records that a trace must be published (#131). The row is durable: if
 * pinning, the market's on-chain creation, or the publish call isn't possible
 * yet, src/jobs/trace-publication.worker.ts finishes it later. An immediate
 * best-effort pass runs in the background so the common case stays fast.
 */
export async function enqueueTracePublication(
  params: { traceId: string; payload: Record<string, unknown>; action: TraceAction },
  deps: { prisma?: any; processNow?: boolean } = {},
): Promise<{ id: string }> {
  const db = deps.prisma ?? prisma;
  const row = await db.tracePublication.upsert({
    where: { traceId: params.traceId },
    create: {
      traceId: params.traceId,
      action: params.action,
      payload: printable(params.payload) as Prisma.InputJsonValue,
    },
    update: {},
  });
  if (deps.processNow ?? true) {
    void processPublication(row, { prisma: db }).catch((err) =>
      logger.warn({ err, traceId: params.traceId }, 'Immediate trace publication pass failed; the worker will retry'),
    );
  }
  return { id: row.id };
}

export interface TraceCheckInput {
  id: string;
  onChainTraceId: bigint;
  traceHash: string | null;
  ipfsCid?: string | null;
  agentWallet?: string | null;
  contentMode?: string | null;
  plaintextHash?: string | null;
}

export interface CheckTraceDeps {
  getOnChainTrace?: (traceId: bigint) => Promise<{
    trace_hash: Buffer | string;
    ipfs_cid: string;
    market_id: bigint;
    agent: string;
    action?: string;
    published_at?: bigint;
  }>;
  fetchVerifiedBytes?: typeof fetchVerifiedBytes;
}

export interface TraceRegistryCheckResult {
  traceId: string;
  onChainTraceId: string;
  ipfsCid: string;
  onChainHash: string;
  onChainMarketId: bigint;
  onChainAgent: string;
  storedHash: string | null;
  storedCid: string | null;
  computedHash: string | null;
  hashMatchesStored: boolean;
  cidMatchesStored: boolean;
  bytesVerified: boolean | null;
  contentSource: 'cache' | 'gateway' | null;
  contentError?: string;
}

/**
 * Pure, read-only verification core (#307): reads the on-chain registry trace
 * and optionally fetches & hashes the pinned bytes without writing audit columns.
 */
export async function checkTraceAgainstRegistry(
  trace: TraceCheckInput,
  deps: CheckTraceDeps & { fetchContent?: boolean; verifiedBy?: string } = {},
): Promise<TraceRegistryCheckResult> {
  const readTrace = deps.getOnChainTrace ?? getOnChainTrace;
  const fetchBytes = deps.fetchVerifiedBytes ?? fetchVerifiedBytes;
  const onChain = await readTrace(trace.onChainTraceId);
  const onChainHash = Buffer.isBuffer(onChain.trace_hash)
    ? onChain.trace_hash.toString('hex').toLowerCase()
    : String(onChain.trace_hash).toLowerCase();

  const storedHash = trace.traceHash?.toLowerCase() ?? null;
  const storedCid = trace.ipfsCid ?? null;
  const hashMatchesStored = storedHash !== null && storedHash === onChainHash;
  const cidMatchesStored = storedCid !== null && storedCid === onChain.ipfs_cid;

  let computedHash: string | null = null;
  let bytesVerified: boolean | null = null;
  let contentSource: 'cache' | 'gateway' | null = null;
  let contentError: string | undefined;

  if (deps.fetchContent !== false) {
    try {
      const { bytes, source } = await fetchBytes(
        onChain.ipfs_cid,
        onChainHash,
        deps.verifiedBy ?? `reasoning_registry:trace:${trace.onChainTraceId}`,
      );
      computedHash = sha256Hex(bytes).toLowerCase();
      bytesVerified = verifyTraceHash(bytes, onChainHash);
      contentSource = source;
    } catch (err) {
      contentError = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    traceId: trace.id,
    onChainTraceId: trace.onChainTraceId.toString(),
    ipfsCid: onChain.ipfs_cid,
    onChainHash,
    onChainMarketId: BigInt(onChain.market_id),
    onChainAgent: onChain.agent,
    storedHash: trace.traceHash,
    storedCid,
    computedHash,
    hashMatchesStored,
    cidMatchesStored,
    bytesVerified,
    contentSource,
    ...(contentError ? { contentError } : {}),
  };
}

/**
 * Fetches the content at the on-chain CID, hashes the exact bytes and
 * compares them with the on-chain trace_hash. Writes audit status on the row.
 */
export async function verifyTraceOnChain(
  traceId: string,
): Promise<TraceVerification & { contentMode?: string; plaintextHash?: string | null }> {
  const trace = (await prisma.reasoningTrace.findUnique({
    where: { id: traceId },
    select: {
      id: true,
      onChainTraceId: true,
      traceHash: true,
      ipfsCid: true,
    },
  })) as (TraceCheckInput & { onChainTraceId: bigint | null }) | null;
  if (!trace) throw new AppError(404, 'TRACE_NOT_FOUND', 'Reasoning trace not found');
  if (trace.onChainTraceId === null) {
    throw new AppError(
      409,
      'TRACE_NOT_PUBLISHED',
      'This trace has not been published on-chain yet',
    );
  }

  const checked = await checkTraceAgainstRegistry({
    ...trace,
    onChainTraceId: trace.onChainTraceId,
  });
  if (checked.contentError || checked.computedHash === null || checked.bytesVerified === null) {
    throw new AppError(502, 'IPFS_RETRIEVAL_FAILED', checked.contentError ?? 'Could not retrieve trace content');
  }
  const verified = checked.bytesVerified;

  await prisma.reasoningTrace.update({
    where: { id: traceId },
    data: {
      verified,
      lastAuditStatus: verified ? 'VERIFIED' : 'HASH_MISMATCH',
      lastAuditedAt: new Date(),
    },
  });

  return {
    traceId,
    onChainTraceId: checked.onChainTraceId,
    ipfsCid: checked.ipfsCid,
    onChainHash: checked.onChainHash,
    computedHash: checked.computedHash,
    storedHash: trace.traceHash,
    verified,
    contentSource: checked.contentSource ?? 'gateway',
    verifiedAt: new Date(),
    contentMode: trace.contentMode,
    plaintextHash: trace.plaintextHash,
  };
}

/**
 * Generalises pin+publish for documents that do not have a ReasoningTrace row
 * (transparency reports, #159). Returns the mode so callers can mark dry runs.
 */
export async function pinAndPublishDocument(params: {
  document: unknown;
  name: string;
  action: string;
  marketId: bigint;
  /** Agent whose control state gates the write; defaults from `action`. */
  scope?: AgentScope;
}, options: { dryRun?: boolean } = {}): Promise<{ cid: string; hash: string; onChainTraceId: bigint | null; publishTxHash: string | null; mode: 'dry-run' | 'live' }> {
  const pinned = await pinJson(params.document, params.name);
  if (options.dryRun) {
    return { cid: pinned.cid, hash: pinned.hash, onChainTraceId: null, publishTxHash: null, mode: 'dry-run' };
  }
  const published = await publishPinnedDocument({
    cid: pinned.cid,
    hash: pinned.hash,
    action: params.action,
    marketId: params.marketId,
    scope: params.scope,
  });
  return { cid: pinned.cid, hash: pinned.hash, ...published };
}

/**
 * Publishes bytes that are already pinned. Used to recover from a crash
 * between pin and publish without recomputing (and re-pinning) the document.
 */
export async function publishPinnedDocument(params: {
  cid: string;
  hash: string;
  action: string;
  marketId: bigint;
  scope?: AgentScope;
}, options: { dryRun?: boolean } = {}): Promise<{ onChainTraceId: bigint | null; publishTxHash: string | null; mode: 'dry-run' | 'live' }> {
  if (options.dryRun) {
    return { onChainTraceId: null, publishTxHash: null, mode: 'dry-run' };
  }
  const result = await publishTrace({
    agent: agentSigner().publicKey as string,
    market_id: params.marketId,
    action: params.action,
    trace_hash: Buffer.from(params.hash, 'hex'),
    ipfs_cid: params.cid,
  }, undefined, params.scope);
  if (result.mode === 'dry-run') {
    return { onChainTraceId: null, publishTxHash: null, mode: 'dry-run' };
  }
  return { onChainTraceId: result.value, publishTxHash: result.txHash, mode: 'live' };
}
