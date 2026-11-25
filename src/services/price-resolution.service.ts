/**
 * Price-mode markets (#90).
 *
 * A CRYPTO proposal can commit to a Reflector (SEP-40) feed instead of a
 * signer set: the market stores a `kind: 'price'` resolution spec, the backend
 * reveals it with `register_price_spec` after creation, and after close anyone
 * can call `resolve_price`, which reads the feed at `close_time` and finalises
 * the market. This module owns the deterministic parts: threshold conversion,
 * question rendering, spec building, feed validation, reveal and the
 * resolution loop with its retry/escalation policy.
 */
import {
  Account,
  Address,
  Contract,
  TransactionBuilder,
  scValToNative,
  xdr,
  rpc,
} from '@stellar/stellar-sdk';
import { z } from 'zod';
import { config } from '../config';
import { feedFor, type ReflectorFeed, type ReflectorFeedAsset } from '../config/reflector-feeds';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { writeAgentLog } from '../lib/agent-log';
import {
  validateResolutionSpec,
  type PriceDirectionName,
  type ResolutionSpecJson,
} from '../lib/resolution-spec';
import { registerPriceSpec, resolvePrice, resolverState, type WriteResult } from './chain.service';
import { ChainError, ChainPendingError } from './stellar/errors';
import { agentSigner, rpcServer } from './stellar/clients';
import { registerHandler, type ChainTransactionRow, type CompletionOutcome } from './stellar/outbox';
import { AlertService } from './alerts.service';
import type { PriceConfig } from '../generated/resolver';

export type OracleAsset = ReflectorFeedAsset;

export interface PriceData {
  price: bigint;
  timestamp: bigint;
}

export interface ReflectorReadOptions {
  /** When true, bypasses the 1 h in-process caches (used by the feed monitor). */
  fresh?: boolean;
}

export interface ReflectorReader {
  decimals(contract: string, opts?: ReflectorReadOptions): Promise<number>;
  supports(contract: string, asset: OracleAsset, opts?: ReflectorReadOptions): Promise<boolean>;
  lastPrice(contract: string, asset: OracleAsset): Promise<PriceData | null>;
  /** Feed update cadence in seconds (SEP-40 `resolution()`). */
  resolution(contract: string, opts?: ReflectorReadOptions): Promise<number>;
  /** Historical price record at `ts` (SEP-40 `price(asset, timestamp)`). */
  price(contract: string, asset: OracleAsset, ts: bigint): Promise<PriceData | null>;
  /** Latest ledger sequence and close time (unix seconds) from RPC. */
  latestLedger(): Promise<{ sequence: number; closeTime: bigint }>;
}

// ─── Threshold conversion ────────────────────────────────────────────────────

/**
 * Converts a human decimal threshold (e.g. "100000", "0.0001") into the feed's
 * fixed-point representation. String arithmetic only: no parseFloat, no
 * rounding. More fractional digits than the feed supports is an error, because
 * silently rounding would flip outcomes.
 */
export function toFixedPoint(human: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0) throw new Error('decimals must be a non-negative integer');
  if (!/^\d+(\.\d+)?$/.test(human)) throw new Error('threshold must be a non-negative decimal string');
  const [whole, frac = ''] = human.split('.');
  if (frac.length > decimals) {
    throw new Error(`threshold has ${frac.length} decimal places but the feed supports ${decimals}`);
  }
  const padded = (frac + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(whole + padded);
}

// ─── Deterministic question text ─────────────────────────────────────────────

const DIRECTION_TEXT: Record<PriceDirectionName, string> = {
  Above: 'above',
  AtOrAbove: 'at or above',
  Below: 'below',
  AtOrBelow: 'at or below',
};

function formatHuman(threshold: string): string {
  const [whole, frac] = threshold.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac ? `${grouped}.${frac}` : grouped;
}

export interface PriceQuestionInput {
  symbol: string;
  direction: PriceDirectionName;
  thresholdHuman: string;
  closeTimeSecs: number;
}

/**
 * Rendered from structured fields only, so the question text and the committed
 * spec can never disagree. `AtOrAbove` reads "at or above", `Above` reads
 * "above", and the close timestamp is ISO-8601 UTC.
 */
export function renderPriceQuestion(input: PriceQuestionInput): string {
  const iso = new Date(input.closeTimeSecs * 1000).toISOString().replace('.000Z', 'Z');
  return `Will the Reflector ${input.symbol.toUpperCase()}/USD price be ${DIRECTION_TEXT[input.direction]} ${formatHuman(
    input.thresholdHuman,
  )} at ${iso}?`;
}

// ─── Structured proposal ─────────────────────────────────────────────────────

export const priceProposalSchema = z.object({
  asset: z.string().min(1),
  threshold: z.string().regex(/^\d+(\.\d+)?$/, 'must be a non-negative decimal string'),
  direction: z.enum(['Above', 'AtOrAbove', 'Below', 'AtOrBelow']),
  close_timestamp: z.number().int().positive(),
});

export type PriceProposal = z.infer<typeof priceProposalSchema>;

/** Builds the committed spec. The threshold is stored as the fixed-point string. */
export function buildPriceSpec(
  proposal: Pick<PriceProposal, 'threshold' | 'direction'>,
  feed: ReflectorFeed,
  decimals: number,
): Extract<ResolutionSpecJson, { kind: 'price' }> {
  const spec: Extract<ResolutionSpecJson, { kind: 'price' }> = {
    kind: 'price',
    reflector: feed.reflector,
    asset: feed.asset,
    threshold: toFixedPoint(proposal.threshold, decimals).toString(),
    direction: proposal.direction,
    maxStaleness: feed.maxStaleness,
  };
  validateResolutionSpec(spec);
  return spec;
}

// ─── Reflector reader (default implementation) ───────────────────────────────

const CACHE_TTL_MS = 60 * 60 * 1000;
const decimalsCache = new Map<string, { at: number; value: number }>();
const assetsCache = new Map<string, { at: number; value: string[] }>();
const resolutionCache = new Map<string, { at: number; value: number }>();

/** Visible for tests: clear in-process Reflector metadata caches. */
export function clearReflectorCaches(): void {
  decimalsCache.clear();
  assetsCache.clear();
  resolutionCache.clear();
}

function assetScVal(asset: OracleAsset): xdr.ScVal {
  if (asset.kind === 'stellar') {
    return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Stellar'), new Address(asset.address).toScVal()]);
  }
  return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Other'), xdr.ScVal.scvSymbol(asset.symbol)]);
}

function symbolOf(asset: OracleAsset): string {
  return asset.kind === 'stellar' ? asset.address : asset.symbol;
}

async function simulate(contract: string, fn: string, args: xdr.ScVal[]): Promise<xdr.ScVal | null> {
  const source = new Account(agentSigner().publicKey as string, '0');
  const op = new Contract(contract).call(fn, ...args);
  const tx = new TransactionBuilder(source, { fee: '100', networkPassphrase: config.STELLAR_NETWORK_PASSPHRASE })
    .addOperation(op)
    .setTimeout(0)
    .build();
  const sim = (await rpcServer.simulateTransaction(tx)) as rpc.Api.SimulateTransactionResponse;
  if (sim && typeof sim === 'object' && 'error' in sim && sim.error) {
    throw new ChainError(`reflector ${fn} simulation failed`, null, { method: fn, cause: String(sim.error) });
  }
  const retval = (sim as { result?: { retval?: xdr.ScVal } }).result?.retval;
  return retval ?? null;
}

function nativePriceData(scVal: xdr.ScVal | null): { price: bigint; timestamp: bigint } | null {
  if (!scVal) return null;
  let native: unknown;
  try {
    native = scValToNative(scVal);
  } catch {
    return null;
  }
  // Option<PriceData>: ScVal void when None, otherwise the struct.
  if (native === null || native === undefined) return null;
  const asRecord = native as Record<string, unknown> | unknown[];
  let price: unknown;
  let timestamp: unknown;
  if (Array.isArray(asRecord)) {
    [price, timestamp] = asRecord;
  } else if (asRecord && typeof asRecord === 'object') {
    price = (asRecord as Record<string, unknown>).price;
    timestamp = (asRecord as Record<string, unknown>).timestamp;
  }
  if (price === undefined || timestamp === undefined || price === null || timestamp === null) return null;
  return { price: BigInt(price as bigint | string | number), timestamp: BigInt(timestamp as bigint | string | number) };
}

/**
 * Minimal SEP-40 client. Only the calls price mode needs are implemented, by
 * simulating an invoke against the contract's public interface.
 */
export function reflectorReader(): ReflectorReader {
  return {
    async decimals(contract, opts) {
      const cached = !opts?.fresh ? decimalsCache.get(contract) : undefined;
      if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
      const raw = await simulate(contract, 'decimals', []);
      const value = Number(scValToNative(raw as xdr.ScVal));
      decimalsCache.set(contract, { at: Date.now(), value });
      return value;
    },
    async supports(contract, asset, opts) {
      const cached = !opts?.fresh ? assetsCache.get(contract) : undefined;
      if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value.includes(symbolOf(asset));
      const raw = await simulate(contract, 'assets', []);
      let symbols: string[] = [];
      try {
        const native = scValToNative(raw as xdr.ScVal) as unknown;
        symbols = (Array.isArray(native) ? native : []).map((a) => symbolOf(a as OracleAsset));
      } catch {
        symbols = [];
      }
      assetsCache.set(contract, { at: Date.now(), value: symbols });
      return symbols.includes(symbolOf(asset));
    },
    async lastPrice(contract, asset) {
      return nativePriceData(await simulate(contract, 'lastprice', [assetScVal(asset)]));
    },
    async resolution(contract, opts) {
      const cached = !opts?.fresh ? resolutionCache.get(contract) : undefined;
      if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
      const raw = await simulate(contract, 'resolution', []);
      const value = Number(scValToNative(raw as xdr.ScVal));
      resolutionCache.set(contract, { at: Date.now(), value });
      return value;
    },
    async price(contract, asset, ts) {
      const tsScVal = xdr.ScVal.scvU64(xdr.Uint64.fromString(ts.toString()));
      return nativePriceData(await simulate(contract, 'price', [assetScVal(asset), tsScVal]));
    },
    async latestLedger() {
      const latest = (await rpcServer.getLatestLedger()) as { sequence?: number | string; closeTime?: number | string };
      const sequence = Number(latest?.sequence ?? 0);
      const rawCloseTime = latest?.closeTime;
      if (rawCloseTime !== undefined && rawCloseTime !== null && Number.isFinite(Number(rawCloseTime)) && Number(rawCloseTime) > 0) {
        return { sequence, closeTime: BigInt(rawCloseTime) };
      }
      // Some RPC builds omit closeTime on getLatestLedger; try getLedgers for the sequence, then wall clock.
      try {
        const getLedgers = (rpcServer as unknown as {
          getLedgers?: (req: { startLedger: number; pagination: { limit: number } }) => Promise<{ ledgers?: Array<{ ledgerCloseTime?: string | number }> }>;
        }).getLedgers;
        if (sequence > 0 && typeof getLedgers === 'function') {
          const res = await getLedgers.call(rpcServer, { startLedger: sequence, pagination: { limit: 1 } });
          const ct = res?.ledgers?.[0]?.ledgerCloseTime;
          if (ct !== undefined && ct !== null && Number(ct) > 0) {
            return { sequence, closeTime: BigInt(ct) };
          }
        }
      } catch {
        // fall through to wall clock
      }
      return { sequence, closeTime: BigInt(Math.floor(Date.now() / 1000)) };
    },
  };
}

// ─── Pre-creation feed validation ────────────────────────────────────────────

export interface FeedCheck {
  ok: boolean;
  reason?:
    | 'NOT_REGISTERED'
    | 'FEED_UNSUPPORTED'
    | 'FEED_STALE'
    | 'NO_DATA';
}

/**
 * A feed that does not support the asset, or that has no recent data, is
 * rejected before the market is committed: a dead feed today is dead at close.
 */
export async function checkFeed(
  network: string,
  symbol: string,
  reader: ReflectorReader,
  now?: Date,
  feedOverride?: ReflectorFeed | null,
): Promise<FeedCheck> {
  const feed = feedOverride ?? feedFor(network, symbol);
  if (!feed) return { ok: false, reason: 'NOT_REGISTERED' };
  if (!(await reader.supports(feed.reflector, feed.asset))) return { ok: false, reason: 'FEED_UNSUPPORTED' };
  const last = await reader.lastPrice(feed.reflector, feed.asset);
  if (!last) return { ok: false, reason: 'NO_DATA' };
  let referenceTs: bigint;
  if (now) {
    referenceTs = BigInt(Math.floor(now.getTime() / 1000));
  } else if (typeof reader.latestLedger === 'function') {
    const ledger = await reader.latestLedger();
    referenceTs = ledger.closeTime;
  } else {
    referenceTs = BigInt(Math.floor(Date.now() / 1000));
  }
  const age = referenceTs - last.timestamp;
  if (age < 0n || age > BigInt(feed.maxStaleness)) return { ok: false, reason: 'FEED_STALE' };
  return { ok: true };
}

// ─── Structured proposal planning ────────────────────────────────────────────

export interface PriceResolutionBlock {
  kind: 'price';
  asset: string;
  thresholdHuman: string;
  thresholdRaw: string;
  decimals: number;
  direction: PriceDirectionName;
  reflector: string;
  /** Feed decimals observed when the market was planned (#309). */
  decimalsAtCreation?: number;
  /** Feed resolution() (seconds) observed when the market was planned (#309). */
  resolutionAtCreation?: number | null;
  /** Citation URL from REFLECTOR_FEEDS_JSON (#309). */
  feedSource?: string;
  /** True when creation-time feed facts were lazily backfilled by the monitor (#309). */
  inferred?: boolean;
}

export interface PricePlan {
  /** Non-null when a committed price spec should replace signer mode. */
  spec: Extract<ResolutionSpecJson, { kind: 'price' }> | null;
  /** Deterministically rendered question, non-null iff `spec` is. */
  question: string | null;
  resolution: PriceResolutionBlock | null;
}

const NOT_A_CANDIDATE: PricePlan = { spec: null, question: null, resolution: null };

export interface PlanPriceMarketInput {
  category: string;
  /** Raw LLM proposal (parsed against priceProposalSchema). */
  proposal: unknown;
  network: string;
  now?: Date;
  reader?: ReflectorReader;
  feed?: ReflectorFeed | null;
}

/**
 * Turns a CRYPTO proposal into a price spec, or falls back to signer mode. Any
 * failure (parse, unregistered asset, dead feed, excess precision) logs
 * `PRICE_SPEC_FALLBACK` and returns null so the caller keeps the current
 * behaviour.
 */
export async function planPriceMarket(
  input: PlanPriceMarketInput,
  marketId: string | null = null,
): Promise<PricePlan> {
  if (input.category.toUpperCase() !== 'CRYPTO') return NOT_A_CANDIDATE;
  const reader = input.reader ?? reflectorReader();

  const fallback = async (reason: string): Promise<PricePlan> => {
    await writeAgentLog({
      agentType: 'MARKET_MAKER',
      level: 'WARN',
      action: 'PRICE_SPEC_FALLBACK',
      marketId: marketId ?? undefined,
      data: { reason },
    }).catch(() => undefined);
    return NOT_A_CANDIDATE;
  };

  const parsed = priceProposalSchema.safeParse(input.proposal);
  if (!parsed.success) return fallback('PARSE_FAILED');
  const proposal = parsed.data;

  const feed = input.feed ?? feedFor(input.network, proposal.asset);
  if (!feed) return fallback('NOT_REGISTERED');

  const check = await checkFeed(input.network, proposal.asset, reader, input.now, feed);
  if (!check.ok) return fallback(check.reason ?? 'FEED_UNUSABLE');

  let decimals: number;
  let spec: Extract<ResolutionSpecJson, { kind: 'price' }>;
  try {
    decimals = await reader.decimals(feed.reflector);
    spec = buildPriceSpec(proposal, feed, decimals);
  } catch {
    return fallback('THRESHOLD_PRECISION');
  }

  let resolutionAtCreation: number | null = null;
  if (typeof reader.resolution === 'function') {
    try {
      resolutionAtCreation = await reader.resolution(feed.reflector);
    } catch {
      resolutionAtCreation = null;
    }
  }

  return {
    spec,
    question: renderPriceQuestion({
      symbol: proposal.asset,
      direction: proposal.direction,
      thresholdHuman: proposal.threshold,
      closeTimeSecs: proposal.close_timestamp,
    }),
    resolution: {
      kind: 'price',
      asset: proposal.asset.toUpperCase(),
      thresholdHuman: proposal.threshold,
      thresholdRaw: spec.threshold,
      decimals,
      direction: proposal.direction,
      reflector: feed.reflector,
      decimalsAtCreation: decimals,
      resolutionAtCreation,
      feedSource: feed.source,
    },
  };
}

// ─── Reveal ──────────────────────────────────────────────────────────────────

/**
 * Reveals a price spec after creation. `MarketAlreadyConfigured` (4) means a
 * previous attempt landed, so it counts as success.
 */
export async function revealPriceSpec(
  onChainMarketId: bigint,
  spec: Extract<ResolutionSpecJson, { kind: 'price' }>,
  deps: { register?: typeof registerPriceSpec; marketId?: string } = {},
): Promise<WriteResult<void>> {
  validateResolutionSpec(spec, { forReveal: true });
  const call = deps.register ?? registerPriceSpec;
  const ref = deps.marketId ? { kind: 'resolver.price_spec', refId: deps.marketId } : { kind: 'resolver.price_spec' };

  if (deps.marketId) {
    await upsertStep(deps.marketId, 'PRICE_SPEC', {
      status: 'IN_FLIGHT',
      attemptsIncrement: 1,
    });
  }

  try {
    const res = await call(onChainMarketId, toPriceConfig(spec), undefined, ref);
    if (deps.marketId && res.mode === 'live') {
      await upsertStep(deps.marketId, 'PRICE_SPEC', {
        status: 'LANDED',
        txHash: res.txHash ?? null,
        landedBy: 'AGENT',
        failureCode: null,
        nextAttemptAt: null,
      });
    }
    return res;
  } catch (err) {
    if (err instanceof ChainError && err.contractError === 'MarketAlreadyConfigured') {
      if (deps.marketId) {
        await upsertStep(deps.marketId, 'PRICE_SPEC', {
          status: 'LANDED_EXTERNALLY',
          landedBy: 'EXTERNAL',
          failureCode: 'MarketAlreadyConfigured',
          nextAttemptAt: null,
        });
      }
      return { mode: config.CHAIN_EXECUTION_MODE === 'live' ? 'live' : 'dry-run', method: 'register_price_spec', value: undefined, txHash: null };
    }
    if (deps.marketId) {
      if (err instanceof ChainPendingError) {
        await upsertStep(deps.marketId, 'PRICE_SPEC', {
          status: 'IN_FLIGHT',
          lastOutboxId: err.outboxId ?? null,
          txHash: err.txHash ?? null,
        });
      } else {
        const code = err instanceof ChainError ? err.contractError ?? 'FAILED' : 'FAILED';
        await upsertStep(deps.marketId, 'PRICE_SPEC', {
          status: 'FAILED',
          failureCode: code,
          nextAttemptAt: new Date(Date.now() + backoffMs(0)),
        });
      }
    }
    throw err;
  }
}

export function toPriceConfig(spec: Extract<ResolutionSpecJson, { kind: 'price' }>): PriceConfig {
  return {
    reflector: spec.reflector,
    asset:
      spec.asset.kind === 'stellar'
        ? { tag: 'Stellar', values: [spec.asset.address] as const }
        : { tag: 'Other', values: [spec.asset.symbol] as const },
    threshold: BigInt(spec.threshold),
    direction: { tag: spec.direction, values: undefined },
    max_staleness: BigInt(spec.maxStaleness),
  };
}

// ─── Resolution loop ─────────────────────────────────────────────────────────

export const RESOLUTION_RETRY_CODES = new Set(['PriceUnavailable', 'StalePrice']);

export interface ResolutionAction {
  retry: boolean;
  escalate: boolean;
  delayMs: number;
}

/**
 * Retry/escalation policy for a single `resolve_price` failure. `PriceUnavailable`
 * and `StalePrice` are transient only until the deadline; after that a guardian
 * must decide (void the market). `MarketNotClosed` always retries (ledger time
 * may be behind). Everything else is terminal.
 */
export function nextResolutionAction(
  contractError: string | undefined,
  elapsedSecs: number,
  maxWaitSecs: number,
  attempt: number,
): ResolutionAction {
  if (contractError === 'MarketNotClosed' || contractError === 'AlreadyFinalized') {
    return { retry: true, escalate: false, delayMs: backoffMs(attempt) };
  }
  if (contractError && RESOLUTION_RETRY_CODES.has(contractError)) {
    if (elapsedSecs >= maxWaitSecs) return { retry: false, escalate: true, delayMs: 0 };
    return { retry: true, escalate: false, delayMs: backoffMs(attempt) };
  }
  return { retry: false, escalate: false, delayMs: 0 };
}

function backoffMs(attempt: number): number {
  return Math.min(config.CHAIN_RETRY_MAX_MS, config.CHAIN_RETRY_BASE_MS * 2 ** Math.min(attempt, 10));
}

export interface ResolutionTickMarket {
  id: string;
  onChainMarketId: bigint | null;
  expiryTimestamp: Date;
  createdAt: Date;
  resolutionSpec?: unknown;
}

export interface ResolutionTickDeps {
  resolve?: typeof resolvePrice;
  state?: typeof resolverState;
  /** Optional close-time snapshot hook run when now >= expiryTimestamp before resolve_price (#309). */
  captureSnapshot?: (market: ResolutionTickMarket) => Promise<void>;
  now?: Date;
  markets?: ResolutionTickMarket[];
}

const TERMINAL_STEP_STATUSES = new Set(['LANDED', 'LANDED_EXTERNALLY', 'ESCALATED']);

function normalizeOutcomeValue(val: unknown): string | null {
  if (!val) return null;
  const tag = typeof val === 'object' && val !== null && 'tag' in val ? (val as { tag?: unknown }).tag : val;
  if (tag === 'Yes' || tag === 'YES') return 'YES';
  if (tag === 'No' || tag === 'NO') return 'NO';
  if (tag === 'Void' || tag === 'VOID') return 'VOID';
  return null;
}

async function safeGetStep(marketId: string, step: string) {
  try {
    return await prisma.marketResolutionStep.findUnique({
      where: { marketId_step: { marketId, step } },
    });
  } catch {
    return null;
  }
}

async function hasInFlightOutbox(kind: string, refId: string): Promise<boolean> {
  try {
    const row = await prisma.chainTransaction.findFirst({
      where: { kind, refId, status: { in: ['PENDING', 'SIGNED', 'SUBMITTED'] } },
      select: { id: true },
    });
    return row !== null;
  } catch {
    return false;
  }
}

async function upsertStep(
  marketId: string,
  step: string,
  data: {
    status: string;
    attemptsIncrement?: number;
    nextAttemptAt?: Date | null;
    escalatedAt?: Date | null;
    txHash?: string | null;
    ledger?: number | null;
    outcome?: string | null;
    failureCode?: string | null;
    landedBy?: string | null;
    lastOutboxId?: string | null;
  },
): Promise<void> {
  try {
    const { attemptsIncrement, ...fields } = data;
    await prisma.marketResolutionStep.upsert({
      where: { marketId_step: { marketId, step } },
      create: {
        marketId,
        step,
        attempts: attemptsIncrement ?? 0,
        ...fields,
      },
      update: {
        ...fields,
        ...(attemptsIncrement ? { attempts: { increment: attemptsIncrement } } : {}),
      },
    });
  } catch {
    // Non-fatal in unit tests or transient DB unavailability
  }
}

async function escalatePriceResolutionOnce(
  marketId: string,
  onChainMarketId: bigint,
  code: string | undefined,
  elapsedSecs: number,
  now: Date,
): Promise<boolean> {
  const existing = await safeGetStep(marketId, 'RESOLVE_PRICE');
  if (existing?.escalatedAt) return false;

  await upsertStep(marketId, 'RESOLVE_PRICE', {
    status: 'ESCALATED',
    failureCode: code ?? 'ESCALATED',
    nextAttemptAt: null,
    escalatedAt: now,
  });

  await writeAgentLog({
    agentType: 'MARKET_MAKER',
    level: 'ERROR',
    action: 'PRICE_RESOLUTION_STUCK',
    marketId,
    data: { onChainMarketId: onChainMarketId.toString(), contractError: code ?? null, elapsedSecs },
  }).catch(() => undefined);

  await new AlertService()
    .sendOps({
      kind: 'ops',
      level: 'CRITICAL',
      severity: 'CRITICAL',
      subjectType: 'market_resolution',
      subjectKey: marketId,
      summary: `Price resolution stuck for market ${marketId} (on-chain #${onChainMarketId})`,
      detail: { onChainMarketId: onChainMarketId.toString(), contractError: code ?? null, elapsedSecs },
      state: 'OPEN',
      incidentId: `price-res:${marketId}`,
      episode: 1,
      notification: 'open',
      adminUrl: `/api/v1/markets/${marketId}`,
    })
    .catch(() => undefined);

  return true;
}

/**
 * One pass of the 5-minute resolution cron. For each closed, price-mode market
 * that the resolver still has Unconfigured/pending, capture a close-time
 * Reflector snapshot (#309), then call `resolve_price`; on the retryable codes
 * back off up to PRICE_RESOLUTION_MAX_WAIT_SECS, then log an ERROR
 * `PRICE_RESOLUTION_STUCK` so a guardian can void the market.
 */
export async function runPriceResolutionTick(deps: ResolutionTickDeps = {}): Promise<{ resolved: bigint[]; escalated: bigint[] }> {
  const resolve = deps.resolve ?? resolvePrice;
  const state = deps.state ?? resolverState;
  const now = deps.now ?? new Date();
  const markets = deps.markets ?? [];
  const resolved: bigint[] = [];
  const escalated: bigint[] = [];

  for (const market of markets) {
    if (market.onChainMarketId === null) continue;

    const step = await safeGetStep(market.id, 'RESOLVE_PRICE');
    if (step && TERMINAL_STEP_STATUSES.has(step.status)) continue;
    if (step?.status === 'IN_FLIGHT') continue;
    if (step?.nextAttemptAt && step.nextAttemptAt > now) continue;
    if (await hasInFlightOutbox('resolver.resolve_price', market.id)) continue;

    const current = await state(market.onChainMarketId);
    if (current.tag === 'Finalized') {
      await upsertStep(market.id, 'RESOLVE_PRICE', {
        status: 'LANDED_EXTERNALLY',
        landedBy: 'EXTERNAL',
        nextAttemptAt: null,
      });
      continue;
    }

    if (deps.captureSnapshot && now.getTime() >= market.expiryTimestamp.getTime()) {
      await deps.captureSnapshot(market).catch((err) => {
        logger.warn({ marketId: market.id, err: err instanceof Error ? err.message : String(err) }, 'close snapshot capture failed; continuing resolution');
      });
    }

    const elapsedSecs = Math.floor((now.getTime() - market.expiryTimestamp.getTime()) / 1000);
    const attempt = step?.attempts ?? 0;

    await upsertStep(market.id, 'RESOLVE_PRICE', {
      status: 'IN_FLIGHT',
      attemptsIncrement: 1,
    });

    try {
      const res = await resolve(market.onChainMarketId, undefined, {
        kind: 'resolver.resolve_price',
        refId: market.id,
      });
      await upsertStep(market.id, 'RESOLVE_PRICE', {
        status: 'LANDED',
        txHash: res.txHash ?? null,
        outcome: normalizeOutcomeValue(res.value),
        landedBy: 'AGENT',
        failureCode: null,
        nextAttemptAt: null,
      });
      resolved.push(market.onChainMarketId);
    } catch (err) {
      if (err instanceof ChainPendingError) {
        await upsertStep(market.id, 'RESOLVE_PRICE', {
          status: 'IN_FLIGHT',
          lastOutboxId: err.outboxId ?? null,
          txHash: err.txHash ?? null,
        });
        continue;
      }

      const code = err instanceof ChainError ? err.contractError ?? undefined : undefined;
      if (code === 'AlreadyFinalized') {
        await upsertStep(market.id, 'RESOLVE_PRICE', {
          status: 'LANDED_EXTERNALLY',
          landedBy: 'EXTERNAL',
          failureCode: 'AlreadyFinalized',
          nextAttemptAt: null,
        });
        continue;
      }

      const action = nextResolutionAction(code ?? undefined, elapsedSecs, config.PRICE_RESOLUTION_MAX_WAIT_SECS, attempt);
      if (action.escalate) {
        const didEscalate = await escalatePriceResolutionOnce(market.id, market.onChainMarketId, code, elapsedSecs, now);
        if (didEscalate) escalated.push(market.onChainMarketId);
      } else if (action.retry) {
        await upsertStep(market.id, 'RESOLVE_PRICE', {
          status: 'FAILED',
          failureCode: code ?? 'RETRYABLE_ERROR',
          nextAttemptAt: new Date(now.getTime() + action.delayMs),
        });
      } else {
        await upsertStep(market.id, 'RESOLVE_PRICE', {
          status: 'FAILED',
          failureCode: code ?? 'TERMINAL_ERROR',
          nextAttemptAt: null,
        });
        logger.warn({ marketId: market.id, code }, 'price resolution stopped');
      }
    }
  }
  return { resolved, escalated };
}

// ─── Outbox completion handlers (#297) ───────────────────────────────────────

async function reconcileResolverStepOnFailure(
  marketId: string,
  step: string,
  row: ChainTransactionRow,
  outcome: CompletionOutcome,
  checkExternal: (stateTag: string) => boolean,
  onStillPending?: (market: { onChainMarketId: bigint | null; expiryTimestamp: Date }) => Promise<void>,
): Promise<void> {
  const market = await prisma.market.findUnique({
    where: { id: marketId },
    select: { onChainMarketId: true, expiryTimestamp: true },
  });
  if (market?.onChainMarketId != null) {
    try {
      const state = await resolverState(market.onChainMarketId);
      if (checkExternal(state.tag)) {
        await upsertStep(marketId, step, {
          status: 'LANDED_EXTERNALLY',
          landedBy: 'EXTERNAL',
          failureCode: outcome.error ?? null,
          nextAttemptAt: null,
          lastOutboxId: row.id,
        });
        return;
      }
    } catch (err) {
      logger.warn({ err, marketId, step }, 'Failed to reconcile resolverState in outbox handler');
    }
  }

  if (onStillPending && market) {
    await onStillPending(market);
    return;
  }

  await upsertStep(marketId, step, {
    status: 'FAILED',
    failureCode: outcome.error ?? (outcome.status === 'EXPIRED' ? 'EXPIRED' : 'FAILED'),
    nextAttemptAt: new Date(Date.now() + backoffMs(0)),
    lastOutboxId: row.id,
  });
}

export async function handleResolverPriceSpecOutcome(
  row: ChainTransactionRow,
  outcome: CompletionOutcome,
): Promise<void> {
  const marketId = row.refId;
  if (!marketId) return;

  if (outcome.status === 'SUCCESS') {
    await upsertStep(marketId, 'PRICE_SPEC', {
      status: 'LANDED',
      txHash: outcome.txHash ?? row.landedHash ?? row.hash ?? null,
      ledger: outcome.ledger ?? row.ledger ?? null,
      landedBy: 'AGENT',
      failureCode: null,
      nextAttemptAt: null,
      lastOutboxId: row.id,
    });
    return;
  }

  if (outcome.error === 'MarketAlreadyConfigured') {
    await upsertStep(marketId, 'PRICE_SPEC', {
      status: 'LANDED_EXTERNALLY',
      landedBy: 'EXTERNAL',
      failureCode: 'MarketAlreadyConfigured',
      nextAttemptAt: null,
      lastOutboxId: row.id,
    });
    return;
  }

  await reconcileResolverStepOnFailure(
    marketId,
    'PRICE_SPEC',
    row,
    outcome,
    (tag) => tag !== 'Unconfigured',
  );
}

export async function handleResolverResolvePriceOutcome(
  row: ChainTransactionRow,
  outcome: CompletionOutcome,
): Promise<void> {
  const marketId = row.refId;
  if (!marketId) return;

  if (outcome.status === 'SUCCESS') {
    await upsertStep(marketId, 'RESOLVE_PRICE', {
      status: 'LANDED',
      txHash: outcome.txHash ?? row.landedHash ?? row.hash ?? null,
      ledger: outcome.ledger ?? row.ledger ?? null,
      outcome: normalizeOutcomeValue(outcome.value),
      landedBy: 'AGENT',
      failureCode: null,
      nextAttemptAt: null,
      lastOutboxId: row.id,
    });
    return;
  }

  if (outcome.error === 'AlreadyFinalized') {
    await upsertStep(marketId, 'RESOLVE_PRICE', {
      status: 'LANDED_EXTERNALLY',
      landedBy: 'EXTERNAL',
      failureCode: 'AlreadyFinalized',
      nextAttemptAt: null,
      lastOutboxId: row.id,
    });
    return;
  }

  await reconcileResolverStepOnFailure(
    marketId,
    'RESOLVE_PRICE',
    row,
    outcome,
    (tag) => tag === 'Finalized',
    async (market) => {
      const existing = await safeGetStep(marketId, 'RESOLVE_PRICE');
      const now = new Date();
      const elapsedSecs = Math.floor((now.getTime() - market.expiryTimestamp.getTime()) / 1000);
      const code = outcome.error ?? undefined;
      const action = nextResolutionAction(code, elapsedSecs, config.PRICE_RESOLUTION_MAX_WAIT_SECS, existing?.attempts ?? 0);
      if (action.escalate && market.onChainMarketId != null) {
        await escalatePriceResolutionOnce(marketId, market.onChainMarketId, code, elapsedSecs, now);
      } else if (action.retry) {
        await upsertStep(marketId, 'RESOLVE_PRICE', {
          status: 'FAILED',
          failureCode: code ?? (outcome.status === 'EXPIRED' ? 'EXPIRED' : 'FAILED'),
          nextAttemptAt: new Date(now.getTime() + action.delayMs),
          lastOutboxId: row.id,
        });
      } else {
        await upsertStep(marketId, 'RESOLVE_PRICE', {
          status: 'FAILED',
          failureCode: code ?? (outcome.status === 'EXPIRED' ? 'EXPIRED' : 'FAILED'),
          nextAttemptAt: null,
          lastOutboxId: row.id,
        });
      }
    },
  );
}

function makeSimpleResolverHandler(step: string, externalCheck: (tag: string) => boolean) {
  return async (row: ChainTransactionRow, outcome: CompletionOutcome): Promise<void> => {
    const marketId = row.refId;
    if (!marketId) return;
    if (outcome.status === 'SUCCESS') {
      await upsertStep(marketId, step, {
        status: 'LANDED',
        txHash: outcome.txHash ?? row.landedHash ?? row.hash ?? null,
        ledger: outcome.ledger ?? row.ledger ?? null,
        outcome: normalizeOutcomeValue(outcome.value),
        landedBy: 'AGENT',
        failureCode: null,
        nextAttemptAt: null,
        lastOutboxId: row.id,
      });
      return;
    }
    await reconcileResolverStepOnFailure(marketId, step, row, outcome, externalCheck);
  };
}

registerHandler('resolver.price_spec', handleResolverPriceSpecOutcome);
registerHandler('resolver.resolve_price', handleResolverResolvePriceOutcome);
registerHandler('resolver.signer_spec', makeSimpleResolverHandler('SIGNER_SPEC', (t) => t !== 'Unconfigured'));
registerHandler('resolver.attest', makeSimpleResolverHandler('ATTEST', (t) => t === 'Finalized'));
registerHandler('resolver.finalize_signers', makeSimpleResolverHandler('FINALIZE_SIGNERS', (t) => t === 'Finalized'));
