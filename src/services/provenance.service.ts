/**
 * End-to-end per-market provenance verification (#307).
 *
 * Audits every link from LLM proposal -> pinned question bytes -> on-chain
 * question commitment -> committed/revealed resolution spec -> resolver
 * registration -> creation transaction (inner & fee-bumped outer hashes) ->
 * every reasoning trace in the reasoning registry.
 *
 * Guarantees:
 * - Read-only: never mutates audit columns (`verified`, `lastAuditStatus`).
 * - No premium leakage: trace bytes are fetched and hashed server-side only;
 *   responses expose hashes, CIDs, ids, and statuses, never trace content or
 *   `previewSources`.
 * - Ledger-aware caching (`prov:<marketId>`) with single-flight coalescing,
 *   short TTL (30 s) on UNAVAILABLE results, and indexer event invalidation.
 */
import { Networks } from '@stellar/stellar-sdk';
import { config } from '../config';
import { CONTRACTS } from '../config/contracts';
import { prisma as defaultPrisma } from '../lib/prisma';
import { getRedis } from '../lib/redis';
import { logger } from '../lib/logger';
import { withTimeout } from '../lib/resilience';
import { resolutionHash, type ResolutionSpecJson } from '../lib/resolution-spec';
import { canonicalJson, sha256Hex } from '../utils/hash.util';
import { AppError } from '../middlewares/error.middleware';
import {
  getOnChainMarketWithLedger,
  getOnChainTraceOrNull,
  resolverStateWithLedger,
  type OnChainMarket,
} from './chain.service';
import { fetchVerifiedBytes } from './ipfs.service';
import { checkTraceAgainstRegistry } from './trace-publish.service';
import { getTransactionReader, readContractEvents } from './stellar/tx-inspect';
import type { ResolutionState } from '../generated/resolver';
import type { Trace } from '../generated/reasoning-registry';

export type LinkStatus = 'VERIFIED' | 'MISMATCH' | 'PENDING' | 'UNAVAILABLE' | 'NOT_APPLICABLE';

export interface ProvenanceLink {
  name: string;
  status: LinkStatus;
  reason?: string;
  expected?: Record<string, string>;
  observed?: Record<string, string>;
  evidence?: Record<string, string>;
  verifyCommand?: string;
}

export interface TraceProvenanceEntry {
  traceId: string;
  onChainTraceId: string | null;
  links: ProvenanceLink[];
}

export interface MarketProvenance {
  marketId: string;
  onChainMarketId: string | null;
  asOfLedger: number | null;
  inputsDigest: string;
  links: ProvenanceLink[];
  traces: TraceProvenanceEntry[];
  summary: {
    verified: number;
    mismatched: number;
    pending: number;
    unavailable: number;
  };
}

export interface ProvenanceDeps {
  getOnChainMarketWithLedger?: (marketId: bigint, signal?: AbortSignal) => Promise<{ market: OnChainMarket; ledger: number }>;
  getOnChainTraceOrNull?: (traceId: bigint, signal?: AbortSignal) => Promise<Trace | null>;
  resolverStateWithLedger?: (marketId: bigint, signal?: AbortSignal) => Promise<{ value: ResolutionState; ledger: number }>;
  getTransaction?: (hash: string) => Promise<any>;
  fetchVerifiedBytes?: typeof fetchVerifiedBytes;
  prisma?: typeof defaultPrisma;
  signal?: AbortSignal;
  rpcUrl?: string;
  ipfsGatewayUrl?: string;
  networkPassphrase?: string;
  contracts?: {
    marketCore: string;
    resolver: string;
    reasoningRegistry: string;
  };
  /** Bypass cache when true (useful for unit tests). */
  bypassCache?: boolean;
}

const UNAVAILABLE_CACHE_TTL_SECONDS = 30;
const PROV_KEY_PREFIX = 'prov:';

interface CachedProvenance {
  value: MarketProvenance;
  asOfLedger: number | null;
  inputsDigest: string;
  expiresAt: number;
}

const memoryCache = new Map<string, CachedProvenance>();
const inFlight = new Map<string, Promise<MarketProvenance>>();

/** Visible for tests: clears the in-process provenance cache and in-flight map. */
export function clearProvenanceCacheForTest(): void {
  memoryCache.clear();
  inFlight.clear();
}

export function provenanceCacheKey(marketId: string): string {
  return `${PROV_KEY_PREFIX}${marketId}`;
}

/** Invalidates the cached provenance for a market (called from indexer `applySideEffects`). */
export async function invalidateProvenanceCache(marketId: string): Promise<void> {
  const key = provenanceCacheKey(marketId);
  memoryCache.delete(key);
  try {
    await getRedis().del(key);
  } catch {
    // Redis optional/unreachable
  }
}

function networkCliFlag(passphrase: string): string {
  if (passphrase === Networks.PUBLIC) return 'mainnet';
  if (passphrase === Networks.FUTURENET) return 'futurenet';
  return 'testnet';
}

function cidFrom(metaUri: string): string {
  return metaUri.replace(/^ipfs:\/\//i, '').replace(/^\/+/, '').trim();
}

function bufToHex(val: Buffer | Uint8Array | string | null | undefined): string {
  if (!val) return '';
  if (typeof val === 'string') return val.toLowerCase().replace(/^0x/, '');
  return Buffer.from(val).toString('hex').toLowerCase();
}

function computeInputsDigest(market: {
  id: string;
  onChainMarketId: bigint | null;
  questionHash: string | null;
  metaUri: string | null;
  resolutionHash: string | null;
  resolutionSpec: unknown;
  generationProvenance: unknown;
  creationTxHash: string | null;
  creationInnerTxHash: string | null;
  chainSyncedLedger: number | null;
  updatedAt?: Date;
  creationAttempt?: { txHash: string | null } | null;
  reasoningTraces: Array<{
    id: string;
    onChainTraceId: bigint | null;
    traceHash: string | null;
    ipfsCid: string | null;
    agentWallet: string | null;
    updatedAt?: Date;
    publication?: { status: string; submittedTxHash: string | null } | null;
  }>;
}): string {
  return sha256Hex(
    canonicalJson({
      id: market.id,
      onChainMarketId: market.onChainMarketId?.toString() ?? null,
      questionHash: market.questionHash,
      metaUri: market.metaUri,
      resolutionHash: market.resolutionHash,
      resolutionSpec: market.resolutionSpec ?? null,
      hasProvenance: market.generationProvenance !== null && market.generationProvenance !== undefined,
      creationTxHash: market.creationTxHash,
      creationInnerTxHash: market.creationInnerTxHash,
      attemptTxHash: market.creationAttempt?.txHash ?? null,
      chainSyncedLedger: market.chainSyncedLedger ?? null,
      traces: market.reasoningTraces.map((t) => ({
        id: t.id,
        onChainTraceId: t.onChainTraceId?.toString() ?? null,
        traceHash: t.traceHash,
        ipfsCid: t.ipfsCid,
        agentWallet: t.agentWallet,
        pubStatus: t.publication?.status ?? null,
        pubTx: t.publication?.submittedTxHash ?? null,
      })),
    }),
  );
}

async function readCachedProvenance(
  marketId: string,
  expectedDigest: string,
  minLedger: number | null,
): Promise<MarketProvenance | null> {
  const key = provenanceCacheKey(marketId);
  const now = Date.now();
  const isFresh = (entry: CachedProvenance): boolean => {
    if (entry.expiresAt <= now) return false;
    if (entry.inputsDigest !== expectedDigest) return false;
    if (minLedger !== null && (entry.asOfLedger === null || entry.asOfLedger < minLedger)) {
      return false;
    }
    return true;
  };

  try {
    const raw = await getRedis().get(key);
    if (raw) {
      const parsed = JSON.parse(raw) as CachedProvenance;
      if (isFresh(parsed)) return parsed.value;
    }
  } catch {
    // Fall back to in-memory cache
  }

  const mem = memoryCache.get(key);
  if (mem && isFresh(mem)) return mem.value;
  return null;
}

async function writeCachedProvenance(
  marketId: string,
  value: MarketProvenance,
): Promise<void> {
  const key = provenanceCacheKey(marketId);
  const ttlSeconds =
    value.summary.unavailable > 0
      ? Math.min(UNAVAILABLE_CACHE_TTL_SECONDS, config.PROVENANCE_CACHE_TTL_SECONDS)
      : config.PROVENANCE_CACHE_TTL_SECONDS;
  const entry: CachedProvenance = {
    value,
    asOfLedger: value.asOfLedger,
    inputsDigest: value.inputsDigest,
    expiresAt: Date.now() + ttlSeconds * 1000,
  };
  memoryCache.set(key, entry);
  try {
    await getRedis().set(key, JSON.stringify(entry), 'EX', ttlSeconds);
  } catch {
    // Redis optional/unreachable
  }
}

/**
 * Builds (or serves from ledger-aware cache with single-flight coalescing) the
 * full end-to-end provenance record for one market.
 */
export async function buildMarketProvenance(
  marketId: string,
  deps: ProvenanceDeps = {},
): Promise<MarketProvenance> {
  const db = deps.prisma ?? defaultPrisma;
  const market = await db.market.findUnique({
    where: { id: marketId },
    select: {
      id: true,
      onChainMarketId: true,
      questionHash: true,
      metaUri: true,
      resolutionHash: true,
      resolutionSpec: true,
      generationProvenance: true,
      creationTxHash: true,
      creationInnerTxHash: true,
      chainSyncedLedger: true,
      updatedAt: true,
      creationAttempt: {
        select: { txHash: true, questionHash: true, resolutionHash: true },
      },
      reasoningTraces: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          onChainTraceId: true,
          traceHash: true,
          ipfsCid: true,
          agentWallet: true,
          updatedAt: true,
          publication: {
            select: { status: true, submittedTxHash: true, submittedTraceId: true },
          },
        },
      },
    },
  });

  if (!market) {
    throw new AppError(404, 'MARKET_NOT_FOUND', `Market ${marketId} not found`);
  }

  const inputsDigest = computeInputsDigest(market);
  const useCache = !deps.bypassCache;

  if (useCache) {
    const cached = await readCachedProvenance(market.id, inputsDigest, market.chainSyncedLedger);
    if (cached) return cached;

    const existingFlight = inFlight.get(market.id);
    if (existingFlight) return existingFlight;
  }

  const compute = async (): Promise<MarketProvenance> => {
    const getMarketOnChain = deps.getOnChainMarketWithLedger ?? getOnChainMarketWithLedger;
    const getTraceOnChain = deps.getOnChainTraceOrNull ?? getOnChainTraceOrNull;
    const getResolverState = deps.resolverStateWithLedger ?? resolverStateWithLedger;
    const getTx = deps.getTransaction ?? ((h: string) => getTransactionReader().getTransaction(h));
    const fetchBytes = deps.fetchVerifiedBytes ?? fetchVerifiedBytes;
    const rpcUrl = deps.rpcUrl ?? config.STELLAR_RPC_URL;
    const gateway = (deps.ipfsGatewayUrl ?? config.IPFS_GATEWAY_URL).replace(/\/$/, '');
    const networkFlag = networkCliFlag(deps.networkPassphrase ?? config.STELLAR_NETWORK_PASSPHRASE);
    const contracts = deps.contracts ?? {
      marketCore: CONTRACTS.marketCore,
      resolver: CONTRACTS.resolver,
      reasoningRegistry: CONTRACTS.reasoningRegistry,
    };

    const links: ProvenanceLink[] = [];
    let asOfLedger: number | null = market.chainSyncedLedger ?? null;
    const bumpLedger = (ledger: number | null | undefined) => {
      if (typeof ledger === 'number' && Number.isFinite(ledger) && ledger > 0) {
        asOfLedger = asOfLedger === null ? ledger : Math.max(asOfLedger, ledger);
      }
    };

    // 1. proposal
    if (market.generationProvenance && typeof market.generationProvenance === 'object') {
      const prov = market.generationProvenance as Record<string, unknown>;
      const evidence: Record<string, string> = {};
      if (typeof prov.source === 'string') evidence.source = prov.source;
      if (typeof prov.provider === 'string') evidence.provider = prov.provider;
      if (typeof prov.model === 'string') evidence.model = prov.model;
      if (typeof prov.promptId === 'string') evidence.promptId = prov.promptId;
      if (prov.promptVersion !== undefined) evidence.promptVersion = String(prov.promptVersion);
      if (typeof prov.promptHash === 'string') evidence.promptHash = prov.promptHash;
      if (typeof prov.outputSha256 === 'string') evidence.outputSha256 = prov.outputSha256;
      links.push({
        name: 'proposal',
        status: 'VERIFIED',
        evidence,
      });
    } else {
      links.push({
        name: 'proposal',
        status: 'NOT_APPLICABLE',
        reason: 'PRE_PROVENANCE_MARKET',
      });
    }

    // 2. question_document
    if (!market.metaUri || !market.questionHash) {
      links.push({
        name: 'question_document',
        status: 'PENDING',
        reason: 'QUESTION_NOT_PINNED',
      });
    } else {
      const cid = cidFrom(market.metaUri);
      const verifyCommand = `curl -s ${gateway}/${cid} | sha256sum`;
      try {
        const { bytes, source } = await withTimeout(
          'ipfs-fetch',
          () => fetchBytes(cid, market.questionHash!, `provenance:question:${market.id}`),
          { signal: deps.signal },
        );
        const computed = sha256Hex(bytes).toLowerCase();
        const expected = market.questionHash.toLowerCase();
        if (computed === expected) {
          links.push({
            name: 'question_document',
            status: 'VERIFIED',
            expected: { questionHash: expected },
            observed: { computedHash: computed },
            evidence: { cid, metaUri: market.metaUri, source },
            verifyCommand,
          });
        } else {
          links.push({
            name: 'question_document',
            status: 'MISMATCH',
            reason: 'HASH_MISMATCH',
            expected: { questionHash: expected },
            observed: { computedHash: computed },
            evidence: { cid, metaUri: market.metaUri, source },
            verifyCommand,
          });
        }
      } catch {
        links.push({
          name: 'question_document',
          status: 'UNAVAILABLE',
          reason: 'IPFS_UNREACHABLE',
          expected: { questionHash: market.questionHash.toLowerCase() },
          evidence: { cid, metaUri: market.metaUri },
          verifyCommand,
        });
      }
    }

    // 3. question_commitment (reads get_market on-chain; reused for resolution_commitment)
    let onChainMarket: OnChainMarket | null = null;
    if (market.onChainMarketId === null) {
      links.push({
        name: 'question_commitment',
        status: 'PENDING',
        reason: 'MARKET_NOT_ON_CHAIN',
      });
    } else {
      const verifyCommand = `stellar contract invoke --network ${networkFlag} --id ${contracts.marketCore} -- get_market --market_id ${market.onChainMarketId.toString()}`;
      try {
        const res = await withTimeout(
          'rpc-read',
          () => getMarketOnChain(market.onChainMarketId!, deps.signal),
          { signal: deps.signal },
        );
        onChainMarket = res.market;
        bumpLedger(res.ledger);

        const observedHash = bufToHex(onChainMarket.question_hash);
        const observedUri = onChainMarket.meta_uri;
        const expectedHash = (market.questionHash ?? '').toLowerCase();
        const expectedUri = market.metaUri ?? '';

        const match = Boolean(expectedHash) && observedHash === expectedHash && observedUri === expectedUri;
        links.push({
          name: 'question_commitment',
          status: match ? 'VERIFIED' : 'MISMATCH',
          ...(match ? {} : { reason: 'ON_CHAIN_QUESTION_MISMATCH' }),
          expected: { questionHash: expectedHash, metaUri: expectedUri },
          observed: { questionHash: observedHash, metaUri: observedUri },
          evidence: { ledger: String(res.ledger), contractId: contracts.marketCore },
          verifyCommand,
        });
      } catch {
        links.push({
          name: 'question_commitment',
          status: 'UNAVAILABLE',
          reason: 'RPC_UNAVAILABLE',
          expected: {
            questionHash: (market.questionHash ?? '').toLowerCase(),
            metaUri: market.metaUri ?? '',
          },
          verifyCommand,
        });
      }
    }

    // 4. resolution_commitment
    if (!market.resolutionSpec) {
      links.push({
        name: 'resolution_commitment',
        status: 'PENDING',
        reason: 'SPEC_NOT_REVEALED',
        ...(market.resolutionHash ? { expected: { resolutionHash: market.resolutionHash.toLowerCase() } } : {}),
      });
    } else {
      const verifyCommand = `echo '${JSON.stringify(market.resolutionSpec)}' | npx tsx scripts/hash-resolution-spec.ts`;
      try {
        const recomputed = resolutionHash(market.resolutionSpec as ResolutionSpecJson).toString('hex').toLowerCase();
        const dbHash = (market.resolutionHash ?? '').toLowerCase();
        const onChainHash = onChainMarket ? bufToHex(onChainMarket.resolution_hash) : null;

        const dbMatches = Boolean(dbHash) && recomputed === dbHash;
        const chainMatches = onChainHash === null ? true : recomputed === onChainHash;

        links.push({
          name: 'resolution_commitment',
          status: dbMatches && chainMatches ? 'VERIFIED' : 'MISMATCH',
          ...(dbMatches && chainMatches ? {} : { reason: 'RESOLUTION_HASH_MISMATCH' }),
          expected: {
            resolutionHash: dbHash,
            ...(onChainHash !== null ? { onChainResolutionHash: onChainHash } : {}),
          },
          observed: { computedResolutionHash: recomputed },
          verifyCommand,
        });
      } catch {
        links.push({
          name: 'resolution_commitment',
          status: 'MISMATCH',
          reason: 'INVALID_RESOLUTION_SPEC',
          ...(market.resolutionHash ? { expected: { resolutionHash: market.resolutionHash.toLowerCase() } } : {}),
          verifyCommand,
        });
      }
    }

    // 5. resolver_registration
    if (market.onChainMarketId === null) {
      links.push({
        name: 'resolver_registration',
        status: 'PENDING',
        reason: 'MARKET_NOT_ON_CHAIN',
      });
    } else {
      const verifyCommand = `stellar contract invoke --network ${networkFlag} --id ${contracts.resolver} -- state --market_id ${market.onChainMarketId.toString()}`;
      try {
        const res = await withTimeout(
          'rpc-read',
          () => getResolverState(market.onChainMarketId!, deps.signal),
          { signal: deps.signal },
        );
        bumpLedger(res.ledger);
        const tag = res.value.tag;
        links.push({
          name: 'resolver_registration',
          status: tag === 'Unconfigured' ? 'PENDING' : 'VERIFIED',
          ...(tag === 'Unconfigured' ? { reason: 'RESOLVER_UNCONFIGURED' } : {}),
          observed: { state: tag },
          evidence: { ledger: String(res.ledger), contractId: contracts.resolver },
          verifyCommand,
        });
      } catch {
        links.push({
          name: 'resolver_registration',
          status: 'UNAVAILABLE',
          reason: 'RPC_UNAVAILABLE',
          verifyCommand,
        });
      }
    }

    // 6. creation_transaction
    if (market.onChainMarketId === null) {
      links.push({
        name: 'creation_transaction',
        status: 'PENDING',
        reason: 'MARKET_NOT_ON_CHAIN',
      });
    } else {
      const candidates = Array.from(
        new Set(
          [market.creationTxHash, market.creationInnerTxHash, market.creationAttempt?.txHash].filter(
            (h): h is string => Boolean(h),
          ),
        ),
      );
      const primaryHash = candidates[0] ?? '';
      const txVerifyCmd = (hash: string) =>
        `curl -s -X POST ${rpcUrl} -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getTransaction","params":{"hash":"${hash}"}}'`;

      let resolvedCreationLink: ProvenanceLink | null = null;
      let sawFailed = false;

      for (const hash of candidates) {
        try {
          const resp = await withTimeout('rpc-read', () => getTx(hash), { signal: deps.signal });
          if (resp?.status === 'SUCCESS') {
            if (typeof resp.ledger === 'number') bumpLedger(resp.ledger);
            const events = readContractEvents(resp);
            const matchedEvent = events.find(
              (ev) => ev.name === 'MarketCreated' && String(ev.data?.market_id) === market.onChainMarketId!.toString(),
            );
            if (matchedEvent) {
              resolvedCreationLink = {
                name: 'creation_transaction',
                status: 'VERIFIED',
                expected: { onChainMarketId: market.onChainMarketId.toString() },
                observed: { txHash: hash, event: 'MarketCreated', marketId: String(matchedEvent.data?.market_id) },
                evidence: {
                  source: 'rpc',
                  txHash: hash,
                  ...(typeof resp.ledger === 'number' ? { ledger: String(resp.ledger) } : {}),
                },
                verifyCommand: txVerifyCmd(hash),
              };
              break;
            }
            // Check indexed MarketCreated for this txHash (e.g. if resultMetaXdr omitted events)
            const indexedForTx = await db.chainEvent.findFirst({
              where: {
                txHash: hash,
                contractName: 'marketCore',
                eventName: 'MarketCreated',
              },
              select: { id: true, ledger: true, txHash: true, params: true },
            });
            if (indexedForTx && String((indexedForTx.params as Record<string, unknown>)?.market_id) === market.onChainMarketId.toString()) {
              resolvedCreationLink = {
                name: 'creation_transaction',
                status: 'VERIFIED',
                expected: { onChainMarketId: market.onChainMarketId.toString() },
                observed: { txHash: hash, event: 'MarketCreated', marketId: market.onChainMarketId.toString() },
                evidence: { source: 'indexed', txHash: indexedForTx.txHash, ledger: String(indexedForTx.ledger), eventId: indexedForTx.id },
                verifyCommand: txVerifyCmd(hash),
              };
              break;
            }
            resolvedCreationLink = {
              name: 'creation_transaction',
              status: 'MISMATCH',
              reason: 'MISSING_MARKET_CREATED_EVENT',
              expected: { onChainMarketId: market.onChainMarketId.toString() },
              observed: { txHash: hash, status: 'SUCCESS' },
              verifyCommand: txVerifyCmd(hash),
            };
            break;
          } else if (resp?.status === 'FAILED') {
            sawFailed = true;
          }
        } catch {
          // Try next candidate hash or indexed fallback
        }
      }

      if (!resolvedCreationLink) {
        // Beyond RPC retention (or no candidate hash landed in RPC): fall back to indexed MarketCreated event
        const indexed = await db.chainEvent.findFirst({
          where: {
            contractName: 'marketCore',
            eventName: 'MarketCreated',
            params: { path: ['market_id'], equals: market.onChainMarketId.toString() },
          },
          orderBy: { ledger: 'asc' },
          select: { id: true, ledger: true, txHash: true },
        });
        if (indexed) {
          bumpLedger(indexed.ledger);
          resolvedCreationLink = {
            name: 'creation_transaction',
            status: 'VERIFIED',
            expected: { onChainMarketId: market.onChainMarketId.toString() },
            observed: { txHash: indexed.txHash, event: 'MarketCreated', marketId: market.onChainMarketId.toString() },
            evidence: {
              source: 'indexed',
              txHash: indexed.txHash,
              ledger: String(indexed.ledger),
              eventId: indexed.id,
            },
            verifyCommand: txVerifyCmd(indexed.txHash),
          };
        } else if (sawFailed) {
          resolvedCreationLink = {
            name: 'creation_transaction',
            status: 'MISMATCH',
            reason: 'CREATION_TX_FAILED',
            expected: { onChainMarketId: market.onChainMarketId.toString() },
            ...(primaryHash ? { observed: { txHash: primaryHash, status: 'FAILED' }, verifyCommand: txVerifyCmd(primaryHash) } : {}),
          };
        } else {
          resolvedCreationLink = {
            name: 'creation_transaction',
            status: 'UNAVAILABLE',
            reason: 'OUTSIDE_RETENTION',
            expected: { onChainMarketId: market.onChainMarketId.toString() },
            ...(primaryHash ? { evidence: { txHash: primaryHash }, verifyCommand: txVerifyCmd(primaryHash) } : {}),
          };
        }
      }

      links.push(resolvedCreationLink);
    }

    // 7. Per-trace provenance (read-only; never exposes trace content or previewSources)
    const traces: TraceProvenanceEntry[] = [];
    for (const trace of market.reasoningTraces) {
      const traceLinks: ProvenanceLink[] = [];
      if (trace.onChainTraceId === null) {
        traceLinks.push({
          name: 'trace_registry',
          status: 'PENDING',
          reason: trace.publication ? trace.publication.status : 'NOT_PUBLISHED',
          ...(trace.publication
            ? {
                observed: {
                  publicationStatus: trace.publication.status,
                  ...(trace.publication.submittedTxHash ? { submittedTxHash: trace.publication.submittedTxHash } : {}),
                },
              }
            : {}),
        });
        traces.push({ traceId: trace.id, onChainTraceId: null, links: traceLinks });
        continue;
      }

      const traceIdStr = trace.onChainTraceId.toString();
      const registryCmd = `stellar contract invoke --network ${networkFlag} --id ${contracts.reasoningRegistry} -- get_trace --trace_id ${traceIdStr}`;
      const isConfidential = (trace as unknown as { contentMode?: string }).contentMode === 'CONFIDENTIAL';
      const hasPublicEnvelopeHash = Boolean((trace as unknown as { plaintextHash?: string | null }).plaintextHash);

      let onChainTrace: Trace | null = null;
      try {
        onChainTrace = await withTimeout(
          'rpc-read',
          () => getTraceOnChain(trace.onChainTraceId!, deps.signal),
          { signal: deps.signal },
        );
      } catch {
        traceLinks.push({
          name: 'trace_registry',
          status: 'UNAVAILABLE',
          reason: 'RPC_UNAVAILABLE',
          verifyCommand: registryCmd,
        });
        traces.push({ traceId: trace.id, onChainTraceId: traceIdStr, links: traceLinks });
        continue;
      }

      if (!onChainTrace) {
        traceLinks.push({
          name: 'trace_registry',
          status: 'MISMATCH',
          reason: 'TRACE_NOT_ON_CHAIN',
          expected: { onChainTraceId: traceIdStr },
          verifyCommand: registryCmd,
        });
        traces.push({ traceId: trace.id, onChainTraceId: traceIdStr, links: traceLinks });
        continue;
      }

      const shouldFetchBytes = !isConfidential || hasPublicEnvelopeHash;
      const check = await checkTraceAgainstRegistry(
        {
          id: trace.id,
          onChainTraceId: trace.onChainTraceId,
          traceHash: trace.traceHash,
          ipfsCid: trace.ipfsCid,
          agentWallet: trace.agentWallet,
        },
        {
          getOnChainTrace: async () => onChainTrace!,
          fetchVerifiedBytes: (cid, expected, verifiedBy) =>
            withTimeout('ipfs-fetch', () => fetchBytes(cid, expected, verifiedBy), { signal: deps.signal }),
          fetchContent: shouldFetchBytes,
          verifiedBy: `provenance:trace:${trace.id}`,
        },
      );

      const marketMatches =
        market.onChainMarketId !== null && check.onChainMarketId === market.onChainMarketId;
      const agentMatches =
        !trace.agentWallet || check.onChainAgent.toUpperCase() === trace.agentWallet.toUpperCase();
      const registryMatches =
        check.hashMatchesStored && check.cidMatchesStored && marketMatches && agentMatches;

      traceLinks.push({
        name: 'trace_registry',
        status: registryMatches ? 'VERIFIED' : 'MISMATCH',
        ...(registryMatches ? {} : { reason: 'REGISTRY_RECORD_MISMATCH' }),
        expected: {
          traceHash: (trace.traceHash ?? '').toLowerCase(),
          ipfsCid: trace.ipfsCid ?? '',
          ...(market.onChainMarketId !== null ? { marketId: market.onChainMarketId.toString() } : {}),
          ...(trace.agentWallet ? { agent: trace.agentWallet } : {}),
        },
        observed: {
          traceHash: check.onChainHash,
          ipfsCid: check.ipfsCid,
          marketId: check.onChainMarketId.toString(),
          agent: check.onChainAgent,
        },
        verifyCommand: registryCmd,
      });

      const contentCmd = `curl -s ${gateway}/${check.ipfsCid} | sha256sum`;
      if (!shouldFetchBytes) {
        traceLinks.push({
          name: 'trace_content',
          status: 'NOT_APPLICABLE',
          reason: 'CONFIDENTIAL',
          evidence: { ipfsCid: check.ipfsCid, onChainHash: check.onChainHash },
        });
      } else if (check.contentError || check.bytesVerified === null) {
        traceLinks.push({
          name: 'trace_content',
          status: 'UNAVAILABLE',
          reason: 'IPFS_UNREACHABLE',
          expected: { traceHash: check.onChainHash },
          evidence: { ipfsCid: check.ipfsCid },
          verifyCommand: contentCmd,
        });
      } else {
        traceLinks.push({
          name: 'trace_content',
          status: check.bytesVerified ? 'VERIFIED' : 'MISMATCH',
          ...(check.bytesVerified ? {} : { reason: 'HASH_MISMATCH' }),
          expected: { traceHash: check.onChainHash },
          observed: { computedHash: check.computedHash ?? '' },
          evidence: {
            ipfsCid: check.ipfsCid,
            ...(check.contentSource ? { source: check.contentSource } : {}),
          },
          verifyCommand: contentCmd,
        });
      }

      traces.push({ traceId: trace.id, onChainTraceId: traceIdStr, links: traceLinks });
    }

    const summary = { verified: 0, mismatched: 0, pending: 0, unavailable: 0 };
    const allLinks = [...links, ...traces.flatMap((t) => t.links)];
    for (const link of allLinks) {
      if (link.status === 'VERIFIED') summary.verified++;
      else if (link.status === 'MISMATCH') summary.mismatched++;
      else if (link.status === 'PENDING') summary.pending++;
      else if (link.status === 'UNAVAILABLE') summary.unavailable++;
    }

    const result: MarketProvenance = {
      marketId: market.id,
      onChainMarketId: market.onChainMarketId?.toString() ?? null,
      asOfLedger,
      inputsDigest,
      links,
      traces,
      summary,
    };

    if (useCache) {
      await writeCachedProvenance(market.id, result);
    }

    return result;
  };

  if (!useCache) {
    return compute();
  }

  const flight = compute().finally(() => {
    inFlight.delete(market.id);
  });
  inFlight.set(market.id, flight);
  return flight;
}
