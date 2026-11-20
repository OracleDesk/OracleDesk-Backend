// Market generation saga (#152, #242).
//
// Each step of the market-maker cycle is a persisted state. A step returns
// its outputs and the next state; the outputs are written (fenced by the
// run's claim token) before the next step's side effect runs, so a crash or
// redeploy resumes from the last completed step and never repeats a paid LLM
// call, a market insert or a chain submission that already succeeded.
//
//   STARTED          gateCycle('MARKET_MAKER')                       → GATED
//   GATED            aggregateSignals() (count + aggregatedAt only)  → SIGNALS_READY
//   SIGNALS_READY    generateMarketQuestion (LLM, once)              → PROPOSED
//   PROPOSED         prepareResolvableProposal, planPriceMarket,
//                    reserveProposal (atomic dedup, #283)            → VALIDATED
//   VALIDATED        planMarketCreation (seed policy)                → SEED_PLANNED
//   SEED_PLANNED     createMarketFromProposal + commitReservation +
//                    run.marketId, in one transaction                → MARKET_PERSISTED
//   MARKET_PERSISTED createMarketOnChain (pin + claimed submission)  → CHAIN_CONFIRMED | CHAIN_SUBMITTED
//   CHAIN_SUBMITTED  market.onChainMarketId, else discoverLandedMarket → CHAIN_CONFIRMED
//   CHAIN_CONFIRMED  generateReasoningTrace (once, guarded by traceId) → TRACE_PERSISTED
//   TRACE_PERSISTED  enqueueTracePublication (upsert by traceId)     → TRACE_ENQUEUED → COMPLETED
//
// Legacy states from the first saga draft resume safely: QUESTION_PINNED →
// CHAIN_SUBMITTED (discovery before any resubmission), TRACE_PINNED /
// TRACE_PUBLISHED → TRACE_ENQUEUED. Trace pinning and publication stay with
// jobs/trace-publication.worker.ts (#131).
import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { MarketGenerationRun, GenerationRunState } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { config } from '../config';
import { AppError } from '../middlewares/error.middleware';
import { aggregateSignals } from './ingestion.service';
import {
  generateMarketQuestion,
  createMarketFromProposal,
  normalizeCategory,
  prepareResolvableProposal,
} from './market.service';
import { reserveProposal, commitReservation, releaseReservation, extendLease } from './market-reservation.service';
import { seedPolicyRecord } from './seed-policy.service';
import { createMarketOnChain, planMarketCreation } from './market-chain.service';
import { discoverLandedMarket } from './market-idempotency.service';
import { planPriceMarket } from './price-resolution.service';
import { evidenceFromSignals, generateReasoningTrace } from './reasoning.service';
import { enqueueTracePublication } from './trace-publish.service';
import { AgentPausedError, gateCycle } from './agent-controls.service';
import { ChainPendingError } from './stellar/errors';
import { TRACE_ACTIONS } from '../lib/trace-actions';
import { writeAgentLog } from '../lib/agent-log';
import { LlmBudgetExceeded, claimDailyOnce, type CallContext, type Priority } from '../lib/llm-budget';
import { toDisplayUsdc } from '../lib/amounts';
import { withAdvisoryLock } from '../lib/advisory-lock';

export const TERMINAL_STATES: readonly GenerationRunState[] = ['COMPLETED', 'SKIPPED', 'NEEDS_ATTENTION', 'CANCELLED'];

/** States in which nothing has been pinned or sent: cancel and abort are honoured. */
export const PRE_CHAIN_STATES: readonly GenerationRunState[] = [
  'STARTED',
  'GATED',
  'SIGNALS_READY',
  'PROPOSED',
  'VALIDATED',
  'SEED_PLANNED',
];

const LEGACY_STATES: Partial<Record<GenerationRunState, GenerationRunState>> = {
  QUESTION_PINNED: 'CHAIN_SUBMITTED',
  TRACE_PINNED: 'TRACE_ENQUEUED',
  TRACE_PUBLISHED: 'TRACE_ENQUEUED',
};

/** Maps a state written by the first saga draft onto the current machine. */
export function normalizeState(state: GenerationRunState): GenerationRunState {
  return LEGACY_STATES[state] ?? state;
}

const LEASE_MS = 300_000;
const HEARTBEAT_MS = 60_000;
const CHAIN_PENDING_RECHECK_MS = 30_000;

/** Outputs are JSON: bigints become strings. */
export function jsonSafe<T>(value: T): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
}

export type RunOutputs = Record<string, any>;

export interface RunContext {
  run: MarketGenerationRun;
  outputs: RunOutputs;
  priority: Priority;
}

interface StepResult {
  outputs?: RunOutputs;
  next: GenerationRunState;
  /** Re-run the same state after this delay instead of advancing (not an error). */
  retryInMs?: number;
}

type StepFn = (ctx: RunContext) => Promise<StepResult>;

/** Thrown when another worker re-claimed the run: our step result is discarded. */
export class FencedOutError extends Error {
  constructor(runId: string) {
    super(`Run ${runId} was re-claimed by another worker`);
    this.name = 'FencedOutError';
  }
}

// Test fault injection: runs before the named state's step.
const sagaFaultHooks = new Map<string, (run: MarketGenerationRun) => Promise<void>>();

export function setSagaFaultHook(step: string, fn: ((run: MarketGenerationRun) => Promise<void>) | null): void {
  if (!fn) sagaFaultHooks.delete(step);
  else sagaFaultHooks.set(step, fn);
}

function skip(reason: string, extra: RunOutputs = {}): StepResult {
  return { outputs: { skipReason: reason, ...extra }, next: 'SKIPPED' };
}

function genContext(priority: Priority): CallContext {
  return { purpose: priority === 'admin' ? 'admin_generation' : 'market_generation', priority };
}

async function loadMarket(ctx: RunContext) {
  const marketId = ctx.run.marketId ?? ctx.outputs.marketId;
  if (!marketId) throw new AppError(500, 'MISSING_MARKET_ID', 'Run has no marketId');
  const market = await prisma.market.findUnique({ where: { id: marketId } });
  if (!market) throw new AppError(404, 'MARKET_NOT_FOUND', `Market ${marketId} not found`);
  return market;
}

// ─── Step handlers ─────────────────────────────────────────────────────────

const STEPS: Partial<Record<GenerationRunState, StepFn>> = {
  STARTED: async () => {
    try {
      const gate = await gateCycle('MARKET_MAKER');
      return { outputs: { gate }, next: 'GATED' };
    } catch (err) {
      if (err instanceof AgentPausedError) return skip('AGENT_PAUSED', { pause: err.details ?? null });
      throw err;
    }
  },

  GATED: async () => {
    // Only the count and timestamp are stored; raw payloads stay in the
    // signal store and are re-read (no LLM cost) by the next step.
    const signals = await aggregateSignals();
    if (signals.signalCount === 0) return skip('NO_SIGNALS');
    return {
      outputs: { signalCount: signals.signalCount, aggregatedAt: signals.aggregatedAt },
      next: 'SIGNALS_READY',
    };
  },

  SIGNALS_READY: async (ctx) => {
    // Idempotency: never pay for a second proposal.
    if (ctx.outputs.proposal) return { next: 'PROPOSED' };

    const signals = await aggregateSignals();
    let generated;
    try {
      generated = await generateMarketQuestion(signals, genContext(ctx.priority));
    } catch (err) {
      if (err instanceof LlmBudgetExceeded) {
        if (await claimDailyOnce('budget-exceeded')) {
          await writeAgentLog({
            agentType: 'MARKET_MAKER',
            level: 'WARN',
            action: 'LLM_BUDGET_EXCEEDED',
            data: { priority: ctx.priority, ...(err.details ?? {}) },
          }).catch(() => {});
        }
        return skip('LLM_BUDGET_EXCEEDED');
      }
      logger.error({ err, runId: ctx.run.id }, 'Market saga: market generation failed');
      return skip('GENERATION_FAILED', { error: err instanceof Error ? err.message : String(err) });
    }

    const { proposal, provenance, groundingSignals } = generated;
    const evidence = evidenceFromSignals(groundingSignals.length > 0 ? groundingSignals : signals.news.slice(0, 3));
    return {
      outputs: {
        proposal,
        proposalProvenance: provenance,
        groundingSignalIds: groundingSignals.map((s: any) => s.id ?? null),
        evidence,
        // #223: the weight set that scored `evidence`, recorded in the trace.
        sourceWeightSet: signals.weightSet ?? null,
      },
      next: 'PROPOSED',
    };
  },

  PROPOSED: async (ctx) => {
    if (ctx.outputs.reservationId) return { next: 'VALIDATED' };

    const prepared = await prepareResolvableProposal(ctx.outputs.proposal);
    if (!prepared) return skip('UNRESOLVABLE');
    let proposal = prepared.proposal;

    let marketSpec: unknown = null;
    if (
      normalizeCategory(proposal.category) === 'CRYPTO' &&
      proposal.price_asset &&
      proposal.price_threshold &&
      proposal.price_direction &&
      proposal.price_close_timestamp
    ) {
      const plan = await planPriceMarket({
        category: 'CRYPTO',
        proposal: {
          asset: proposal.price_asset,
          threshold: proposal.price_threshold,
          direction: proposal.price_direction,
          close_timestamp: proposal.price_close_timestamp,
        },
        network: config.STELLAR_NETWORK_PASSPHRASE,
      });
      if (plan.spec && plan.question) {
        marketSpec = plan.spec;
        proposal = { ...proposal, market_question: plan.question };
      }
    }

    const reservation = await reserveProposal({ proposal, cycleId: ctx.run.cycleId ?? ctx.run.id });
    if (!reservation.ok) {
      await writeAgentLog({
        agentType: 'MARKET_MAKER',
        level: 'WARN',
        action: 'DUPLICATE_SKIPPED',
        marketId: reservation.match?.marketId,
        data: {
          reason: reservation.reason,
          competingReservationId: reservation.competingReservationId,
          match: reservation.match,
          runId: ctx.run.id,
        },
      }).catch(() => {});
      return skip('DUPLICATE', { dedup: { reason: reservation.reason, match: reservation.match ?? null } });
    }

    const market = await prisma.$transaction(async (tx) => {
      const created = await createMarketFromProposal(proposal, undefined, undefined, tx);
      await tx.marketGenerationRun.update({
        where: { id: ctx.run.id },
        data: { marketId: created.id },
      });
      return created;
    });

    return {
      outputs: {
        proposal,
        resolutionDetails: prepared.resolution,
        marketSpec,
        reservationId: reservation.reservationId,
      },
      next: 'VALIDATED',
    };
  },

  VALIDATED: async (ctx) => {
    if (ctx.outputs.seedDecision) return { next: 'SEED_PLANNED' };
    const proposal = ctx.outputs.proposal;
    const decision = await planMarketCreation({
      category: normalizeCategory(proposal.category),
      closeTime: new Date(proposal.expiry_timestamp * 1000),
      p: proposal.initial_yes_probability,
      ci: proposal.confidence_interval,
      llmSuggestedSeedUsdc: proposal.minimum_liquidity_usdc,
    });
    if (decision.action === 'skip') {
      await writeAgentLog({
        agentType: 'MARKET_MAKER',
        level: 'WARN',
        action: 'SEED_SKIPPED',
        data: { reason: decision.reason, question: proposal.market_question, inputs: decision.inputs, runId: ctx.run.id },
      }).catch(() => {});
      await releaseReservation(ctx.outputs.reservationId, 'seed-policy-skip').catch(() => {});
      return skip('SEED_POLICY', { seedDecision: jsonSafe(decision) });
    }
    return {
      outputs: {
        seedDecision: jsonSafe(decision),
        seedPolicy: jsonSafe(seedPolicyRecord(decision)),
      },
      next: 'SEED_PLANNED',
    };
  },

  SEED_PLANNED: async (ctx) => {
    if (ctx.run.marketId) return { outputs: { marketId: ctx.run.marketId }, next: 'MARKET_PERSISTED' };
    const { proposal, seedDecision, seedPolicy, proposalProvenance, resolutionDetails, reservationId } = ctx.outputs;
    await extendLease(reservationId).catch(() => {});

    // The market row, the reservation commit and run.marketId share one
    // transaction: a crash leaves either all three or none.
    const marketId = await prisma.$transaction(async (tx) => {
      const created = await createMarketFromProposal(
        {
          ...proposal,
          initial_yes_probability: seedDecision.pAdj,
          minimum_liquidity_usdc: toDisplayUsdc(BigInt(seedDecision.seedRaw)),
        },
        proposalProvenance,
        resolutionDetails,
        tx,
      );
      await tx.market.update({ where: { id: created.id }, data: { seedPolicy: seedPolicy as object } });
      await commitReservation(reservationId, created.id, tx);
      const linked = await tx.marketGenerationRun.updateMany({
        where: { id: ctx.run.id, fence: ctx.run.fence },
        data: { marketId: created.id },
      });
      if (linked.count === 0) throw new FencedOutError(ctx.run.id);
      return created.id;
    });
    logger.info({ runId: ctx.run.id, marketId }, 'Market saga: market persisted');
    return { outputs: { marketId }, next: 'MARKET_PERSISTED' };
  },

  MARKET_PERSISTED: async (ctx) => {
    const market = await loadMarket(ctx);
    if (market.onChainMarketId !== null && market.onChainMarketId !== undefined) {
      return { outputs: { onChainMarketId: market.onChainMarketId.toString() }, next: 'CHAIN_CONFIRMED' };
    }
    const { seedDecision, marketSpec } = ctx.outputs;
    try {
      // createMarketOnChain claims the creation attempt and runs discovery
      // before any submission (#41), and reuses the stored questionHash.
      const result = await createMarketOnChain(market, (marketSpec ?? undefined) as any, {
        seedRaw: BigInt(seedDecision.seedRaw),
        initialYesBps: seedDecision.initialYesBps,
      });
      if (result.mode === 'live') {
        return {
          outputs: { onChainMarketId: result.value.toString(), chainTxHash: result.txHash, simulated: false },
          next: 'CHAIN_CONFIRMED',
        };
      }
      // Dry-run: the market stays PENDING and the run completes without an id.
      return { outputs: { onChainMarketId: null, simulated: true }, next: 'CHAIN_CONFIRMED' };
    } catch (err) {
      if (err instanceof ChainPendingError) {
        return {
          outputs: { chainTxHash: err.txHash, outboxId: err.outboxId },
          next: 'CHAIN_SUBMITTED',
          retryInMs: CHAIN_PENDING_RECHECK_MS,
        };
      }
      throw err;
    }
  },

  CHAIN_SUBMITTED: async (ctx) => {
    const market = await loadMarket(ctx);
    // The market.create outbox handler may have linked it while we waited.
    if (market.onChainMarketId !== null && market.onChainMarketId !== undefined) {
      return { outputs: { onChainMarketId: market.onChainMarketId.toString() }, next: 'CHAIN_CONFIRMED' };
    }
    if (market.questionHash && market.resolutionHash) {
      const found = await discoverLandedMarket({
        marketId: market.id,
        questionHashHex: market.questionHash,
        resolutionHashHex: market.resolutionHash,
        txHash: ctx.outputs.chainTxHash ?? null,
      });
      if (found !== null) {
        await prisma.market.update({ where: { id: market.id }, data: { onChainMarketId: found, status: 'ACTIVE' } });
        return { outputs: { onChainMarketId: found.toString() }, next: 'CHAIN_CONFIRMED' };
      }
    }
    if (config.CHAIN_EXECUTION_MODE === 'dry-run') {
      return { outputs: { onChainMarketId: null, simulated: true }, next: 'CHAIN_CONFIRMED' };
    }
    return { next: 'CHAIN_SUBMITTED', retryInMs: CHAIN_PENDING_RECHECK_MS };
  },

  CHAIN_CONFIRMED: async (ctx) => {
    if (ctx.outputs.traceId) return { next: 'TRACE_PERSISTED' };
    const market = await loadMarket(ctx);
    const { proposal, seedDecision, seedPolicy, evidence, proposalProvenance, sourceWeightSet } = ctx.outputs;
    const { trace, tracePayload } = await generateReasoningTrace(
      {
        marketId: market.id,
        agentType: 'MARKET_MAKER',
        decisionType: 'MARKET_CREATION',
        sourcesUsed: evidence ?? [],
        probabilityEstimate: proposal.initial_yes_probability,
        marketProbability: seedDecision.pAdj,
        edge: proposal.initial_yes_probability - seedDecision.pAdj,
        confidenceInterval: proposal.confidence_interval,
        seedPolicy,
        sourceWeightSet: sourceWeightSet ?? undefined,
      } as any,
      { purpose: ctx.priority === 'admin' ? 'admin_trace_hedge' : 'trace_hedge', priority: ctx.priority },
      { upstreamProvenance: proposalProvenance ? [proposalProvenance] : [] },
    );
    return {
      outputs: {
        traceId: trace.id,
        // The validated document, unchanged (#227); publish_trace carries the market id.
        tracePayload: jsonSafe(tracePayload),
      },
      next: 'TRACE_PERSISTED',
    };
  },

  TRACE_PERSISTED: async (ctx) => {
    const { traceId, tracePayload } = ctx.outputs;
    if (!traceId || !tracePayload) throw new AppError(500, 'MISSING_TRACE', 'Run has no persisted trace');
    // Upserts by traceId, so a resumed run never queues the trace twice.
    const { id } = await enqueueTracePublication({ traceId, payload: tracePayload, action: TRACE_ACTIONS.createMarket });
    return { outputs: { publicationId: id }, next: 'TRACE_ENQUEUED' };
  },

  TRACE_ENQUEUED: async () => ({ next: 'COMPLETED' }),
};

// ─── Engine ────────────────────────────────────────────────────────────────

export async function startRun(
  trigger: 'cron' | 'admin' | 'resume',
  opts: { cycleId?: string; inputs?: Record<string, unknown> } = {},
): Promise<string> {
  const run = await prisma.marketGenerationRun.create({
    data: {
      trigger,
      state: 'STARTED',
      cycleId: opts.cycleId ?? null,
      inputs: jsonSafe(opts.inputs ?? {}),
      outputs: {},
    },
  });
  return run.id;
}

/**
 * Leases a run to `workerId`. Increments `fence`, so any earlier holder's
 * writes (which are conditioned on the old fence) are rejected from now on.
 */
export async function claimRun(
  runId: string,
  workerId: string,
  leaseMs = LEASE_MS,
  now = new Date(),
): Promise<MarketGenerationRun | null> {
  const claimed = await prisma.marketGenerationRun.updateMany({
    where: {
      id: runId,
      state: { notIn: [...TERMINAL_STATES] },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
    },
    data: { lockedBy: workerId, lockedUntil: new Date(now.getTime() + leaseMs), fence: { increment: 1 } },
  });
  if (claimed.count === 0) return null;
  return prisma.marketGenerationRun.findUnique({ where: { id: runId } });
}

/** Writes a step result only if this worker still holds the run's fence. */
async function fencedUpdate(run: MarketGenerationRun, data: Prisma.MarketGenerationRunUncheckedUpdateManyInput) {
  const res = await prisma.marketGenerationRun.updateMany({ where: { id: run.id, fence: run.fence }, data });
  if (res.count === 0) throw new FencedOutError(run.id);
  const next = await prisma.marketGenerationRun.findUnique({ where: { id: run.id } });
  if (!next) throw new AppError(404, 'RUN_NOT_FOUND', `Run ${run.id} not found`);
  return next;
}

function isPermanent(err: any, attempts: number): boolean {
  return (
    attempts >= config.SAGA_MAX_ATTEMPTS ||
    err?.code === 'IPFS_NOT_CONFIGURED' ||
    String(err?.message ?? '').includes('TradeCapExceeded') ||
    String(err?.message ?? '').includes('DailyCapExceeded')
  );
}

export async function advance(
  runId: string,
  opts: { maxSteps?: number; workerId?: string; signal?: AbortSignal; priority?: Priority } = {},
): Promise<MarketGenerationRun> {
  const workerId = opts.workerId ?? `worker-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  let run = await claimRun(runId, workerId);
  if (!run) {
    const existing = await prisma.marketGenerationRun.findUnique({ where: { id: runId } });
    if (!existing) throw new AppError(404, 'RUN_NOT_FOUND', `Run ${runId} not found`);
    return existing;
  }

  const priority: Priority = opts.priority ?? (run.trigger === 'admin' ? 'admin' : 'cron');
  const fence = run.fence;
  // Keep the lease alive during long steps (LLM calls, chain waits).
  const heartbeat = setInterval(() => {
    prisma.marketGenerationRun
      .updateMany({ where: { id: runId, fence }, data: { lockedUntil: new Date(Date.now() + LEASE_MS) } })
      .catch((err: unknown) => logger.warn({ err, runId }, 'Market saga: lease heartbeat failed'));
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  try {
    for (let steps = 0; steps < (opts.maxSteps ?? 50); steps++) {
      const state = normalizeState(run.state);
      if (state !== run.state) run = await fencedUpdate(run, { state });
      if (TERMINAL_STATES.includes(state)) break;

      // An abort is honoured only before anything is pinned or sent.
      if (opts.signal?.aborted && PRE_CHAIN_STATES.includes(state)) break;

      const stepFn = STEPS[state];
      if (!stepFn) {
        logger.error({ runId, state }, 'Market saga: no step handler');
        break;
      }

      const outputs = { ...((run.outputs as RunOutputs) ?? {}) };
      try {
        const hook = sagaFaultHooks.get(state);
        if (hook) await hook(run);
        const result = await stepFn({ run, outputs, priority });
        const merged = jsonSafe({ ...outputs, ...(result.outputs ?? {}) });
        const marketId = typeof (merged as any).marketId === 'string' ? (merged as any).marketId : run.marketId;
        if (result.next === 'SKIPPED' || result.next === 'CANCELLED') {
          if (outputs.reservationId && !run.marketId) {
            await releaseReservation(outputs.reservationId, `saga-${String((merged as any).skipReason ?? result.next)}`).catch(() => {});
          }
        }
        run = await fencedUpdate(run, {
          state: result.next,
          outputs: merged,
          marketId,
          lastError: Prisma.DbNull,
          attempts: 0,
          nextAttemptAt: result.retryInMs ? new Date(Date.now() + result.retryInMs) : null,
        });
        if (result.retryInMs) break;
      } catch (err: any) {
        if (err instanceof FencedOutError) {
          logger.warn({ runId, workerId }, 'Market saga: lease lost; another worker owns the run');
          return (await prisma.marketGenerationRun.findUnique({ where: { id: runId } })) ?? run;
        }
        const attempts = run.attempts + 1;
        const permanent = isPermanent(err, attempts);
        logger.error({ err, runId, state, attempts, permanent }, 'Market saga: step failed');
        run = await fencedUpdate(run, {
          state: permanent ? 'NEEDS_ATTENTION' : state,
          attempts,
          nextAttemptAt: permanent ? null : new Date(Date.now() + Math.min(2 ** attempts * 30_000, 3_600_000)),
          lastError: { step: state, message: String(err?.message ?? err), code: err?.code ?? err?.name ?? null },
        }).catch(() => run!);
        break;
      }
    }
  } finally {
    clearInterval(heartbeat);
    await prisma.marketGenerationRun
      .updateMany({ where: { id: runId, fence }, data: { lockedBy: null, lockedUntil: null } })
      .catch(() => {});
  }
  return run;
}

/**
 * Resume sweep: selects and claims due runs inside a short advisory-locked
 * transaction, then advances them outside it (the lock is transaction-scoped
 * and must never span an LLM call).
 */
export async function resumeIncomplete(limit = 5): Promise<number> {
  const workerId = `resume-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  const now = new Date();
  const locked = await withAdvisoryLock('saga:resume', async (tx) => {
    const due = await tx.marketGenerationRun.findMany({
      where: {
        state: { notIn: [...TERMINAL_STATES] },
        AND: [
          { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
          { OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true },
    });
    return due.map((r) => r.id);
  }, { timeoutMs: 10_000 });
  if (!locked.acquired) return 0;

  let processed = 0;
  for (const id of locked.value) {
    try {
      await advance(id, { workerId });
      processed++;
    } catch (err: any) {
      logger.warn({ runId: id, err: err?.message }, 'Market saga: resume failed');
    }
  }
  return processed;
}

/** Cancel is allowed while nothing has been pinned or sent (and after NEEDS_ATTENTION in those states). */
export async function cancelRun(runId: string, reason = 'Admin cancelled'): Promise<MarketGenerationRun> {
  const run = await prisma.marketGenerationRun.findUnique({ where: { id: runId } });
  if (!run) throw new AppError(404, 'RUN_NOT_FOUND', `Run ${runId} not found`);
  const failedStep = ((run.lastError as any)?.step ?? null) as GenerationRunState | null;
  const effective = run.state === 'NEEDS_ATTENTION' && failedStep ? failedStep : run.state;
  if (!PRE_CHAIN_STATES.includes(normalizeState(effective))) {
    throw new AppError(400, 'CANNOT_CANCEL_AFTER_PIN', 'Cannot cancel a run once the market has been pinned or submitted');
  }

  const outputs = (run.outputs as RunOutputs) ?? {};
  return prisma.$transaction(async (tx) => {
    if (run.marketId) {
      const market = await tx.market.findUnique({ where: { id: run.marketId } });
      if (market && market.status === 'PENDING') {
        await tx.market.update({ where: { id: market.id }, data: { status: 'CANCELLED' } });
        await tx.agentLog.create({
          data: { agentType: 'MARKET_MAKER', level: 'WARN', action: 'MARKET_CANCELLED', marketId: market.id, data: { reason, runId } },
        });
      }
    } else if (outputs.reservationId) {
      await releaseReservation(outputs.reservationId, 'saga-cancelled').catch(() => {});
    }
    return tx.marketGenerationRun.update({
      where: { id: runId },
      data: { state: 'CANCELLED', lastError: { reason }, lockedBy: null, lockedUntil: null },
    });
  });
}

/** Resets a NEEDS_ATTENTION run to the step that failed so the sweep retries it. */
export async function retryRun(runId: string): Promise<MarketGenerationRun> {
  const run = await prisma.marketGenerationRun.findUnique({ where: { id: runId } });
  if (!run) throw new AppError(404, 'RUN_NOT_FOUND', `Run ${runId} not found`);
  if (run.state !== 'NEEDS_ATTENTION') {
    throw new AppError(400, 'RUN_NOT_RETRYABLE', `Only NEEDS_ATTENTION runs can be retried (state ${run.state})`);
  }
  const step = ((run.lastError as any)?.step ?? null) as GenerationRunState | null;
  if (!step || TERMINAL_STATES.includes(step)) {
    throw new AppError(400, 'RUN_NOT_RETRYABLE', 'Run has no recorded failed step');
  }
  return prisma.marketGenerationRun.update({
    where: { id: runId },
    data: { state: normalizeState(step), attempts: 0, nextAttemptAt: null, lockedBy: null, lockedUntil: null },
  });
}

/** Admin list view: the proposal is reduced to its question. */
export function redactRun(run: MarketGenerationRun) {
  const outputs = (run.outputs as RunOutputs) ?? {};
  const { proposal, proposalProvenance, tracePayload, evidence, ...rest } = outputs;
  return {
    ...run,
    outputs: { ...rest, ...(proposal ? { question: proposal.market_question ?? null } : {}) },
  };
}
