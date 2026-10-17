import crypto from 'node:crypto';
import type { Market, MarketGenerationRun, GenerationRunState } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { config } from '../config';
import { CONTRACTS } from '../config/contracts';
import { AppError } from '../middlewares/error.middleware';
import { aggregateSignals } from './ingestion.service';
import {
  generateMarketQuestion,
  isDuplicateMarket,
  createMarketFromProposal,
} from './market.service';
import {
  prepareMarketCommitment,
  submitMarketCreation,
} from './market-chain.service';
import { generateReasoningTrace } from './reasoning.service';
import { pinTrace, publishPinnedTrace } from './trace-publish.service';
import { marketCount, getOnChainMarket, getOnChainTrace } from './chain.service';

export interface RunOutputs {
  v: number;
  questionCid?: string;
  questionHash?: string;
  resolutionHash?: string;
  chainTxHash?: string | null;
  onChainMarketId?: string | null;
  traceId?: string;
  traceCid?: string;
  traceHash?: string;
  traceTxHash?: string | null;
  onChainTraceId?: string | null;
  tracePayload?: any;
}

export interface RunContext {
  run: MarketGenerationRun;
  inputs: any;
  outputs: RunOutputs;
}

type StepFn = (ctx: RunContext) => Promise<{
  inputs?: any;
  outputs?: Partial<RunOutputs>;
  next: GenerationRunState;
  marketId?: string;
}>;

// Test fault injection hook
const sagaFaultHooks = new Map<string, (run: MarketGenerationRun) => Promise<void>>();

export function setSagaFaultHook(
  step: string,
  fn: ((run: MarketGenerationRun) => Promise<void>) | null,
): void {
  if (!fn) {
    sagaFaultHooks.delete(step);
  } else {
    sagaFaultHooks.set(step, fn);
  }
}

/**
 * Recovers an on-chain market creation by scanning downward from market_count()
 * matching question_hash and creator === CONTRACTS.treasury.
 */
export async function recoverLostMarketCreation(
  questionHashHex: string,
  scanCount = config.SAGA_RECOVERY_SCAN,
): Promise<bigint | null> {
  try {
    const count = await marketCount();
    if (count <= 0n) return null;

    const start = count - 1n;
    const end = count > BigInt(scanCount) ? count - BigInt(scanCount) : 0n;

    for (let id = start; id >= end; id--) {
      try {
        const m = await getOnChainMarket(id);
        const qHashHex = Buffer.from(m.question_hash).toString('hex');
        if (
          qHashHex.toLowerCase() === questionHashHex.toLowerCase() &&
          m.creator === CONTRACTS.treasury
        ) {
          logger.info({ onChainMarketId: id.toString() }, 'Recovered lost on-chain market creation');
          return id;
        }
      } catch {
        // Continue scanning
      }
    }
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Failed during market creation recovery scan');
  }
  return null;
}

// ─── Step Handlers ─────────────────────────────────────────────────────────────

const STEPS: Record<string, StepFn> = {
  STARTED: async (ctx) => {
    const signals = await aggregateSignals();
    if (!signals || signals.signalCount === 0) {
      logger.info('No signals available; skipping market-maker cycle');
      return { next: 'SKIPPED' as GenerationRunState };
    }

    const compactSignals = {
      signalCount: signals.signalCount,
      aggregatedAt: signals.aggregatedAt,
      newsTitles: signals.news.slice(0, 5).map((s) => s.title),
      fedCount: signals.fed.length,
      macroCount: signals.macro.length,
    };

    return {
      inputs: { ...ctx.inputs, signals: compactSignals, rawSignals: signals },
      next: 'SIGNALS_READY' as GenerationRunState,
    };
  },

  SIGNALS_READY: async (ctx) => {
    const signals = ctx.inputs.rawSignals || (await aggregateSignals());
    const proposal = await generateMarketQuestion(signals);
    if (!proposal) {
      return { next: 'SKIPPED' as GenerationRunState };
    }

    const duplicate = await isDuplicateMarket(proposal.market_question);
    if (duplicate) {
      logger.info({ question: proposal.market_question }, 'Duplicate market proposed; skipping');
      return { next: 'SKIPPED' as GenerationRunState };
    }

    return {
      inputs: { ...ctx.inputs, proposal },
      next: 'PROPOSED' as GenerationRunState,
    };
  },

  PROPOSED: async (ctx) => {
    if (ctx.run.marketId) {
      return { next: 'MARKET_PERSISTED' as GenerationRunState };
    }

    const proposal = ctx.inputs.proposal;
    if (!proposal) {
      throw new AppError(500, 'MISSING_PROPOSAL', 'Proposal missing in run inputs');
    }

    const market = await prisma.$transaction(async (tx) => {
      const created = await createMarketFromProposal(proposal, tx);
      await tx.marketGenerationRun.update({
        where: { id: ctx.run.id },
        data: { marketId: created.id },
      });
      return created;
    });

    return {
      marketId: market.id,
      next: 'MARKET_PERSISTED' as GenerationRunState,
    };
  },

  MARKET_PERSISTED: async (ctx) => {
    const marketId = ctx.run.marketId;
    if (!marketId) throw new AppError(500, 'MISSING_MARKET_ID', 'Run has no marketId');

    const market = await prisma.market.findUnique({ where: { id: marketId } });
    if (!market) throw new AppError(404, 'MARKET_NOT_FOUND', `Market ${marketId} not found`);

    const prep = await prepareMarketCommitment(market);
    return {
      outputs: {
        questionCid: prep.questionCid,
        questionHash: prep.questionHash,
        resolutionHash: prep.resolutionHashHex,
      },
      next: 'QUESTION_PINNED' as GenerationRunState,
    };
  },

  QUESTION_PINNED: async (ctx) => {
    const marketId = ctx.run.marketId;
    if (!marketId) throw new AppError(500, 'MISSING_MARKET_ID', 'Run has no marketId');

    const market = await prisma.market.findUnique({ where: { id: marketId } });
    if (!market) throw new AppError(404, 'MARKET_NOT_FOUND', `Market ${marketId} not found`);

    const qHash = ctx.outputs.questionHash || market.questionHash;
    if (qHash) {
      const recoveredId = await recoverLostMarketCreation(qHash);
      if (recoveredId !== null) {
        await prisma.market.update({
          where: { id: market.id },
          data: { onChainMarketId: recoveredId, status: 'ACTIVE' },
        });
        return {
          outputs: { onChainMarketId: recoveredId.toString() },
          next: 'CHAIN_CONFIRMED' as GenerationRunState,
        };
      }
    }

    const result = await submitMarketCreation(market);
    if (result.mode === 'live') {
      return {
        outputs: {
          chainTxHash: result.txHash,
          onChainMarketId: result.value.toString(),
        },
        next: 'CHAIN_CONFIRMED' as GenerationRunState,
      };
    }

    return {
      outputs: {
        chainTxHash: null,
        onChainMarketId: null,
      },
      next: 'CHAIN_CONFIRMED' as GenerationRunState,
    };
  },

  CHAIN_SUBMITTED: async (ctx) => {
    const marketId = ctx.run.marketId;
    if (!marketId) throw new AppError(500, 'MISSING_MARKET_ID', 'Run has no marketId');

    const market = await prisma.market.findUnique({ where: { id: marketId } });
    if (!market) throw new AppError(404, 'MARKET_NOT_FOUND', `Market ${marketId} not found`);

    const qHash = ctx.outputs.questionHash || market.questionHash;
    if (qHash) {
      const recoveredId = await recoverLostMarketCreation(qHash);
      if (recoveredId !== null) {
        await prisma.market.update({
          where: { id: market.id },
          data: { onChainMarketId: recoveredId, status: 'ACTIVE' },
        });
        return {
          outputs: { onChainMarketId: recoveredId.toString() },
          next: 'CHAIN_CONFIRMED' as GenerationRunState,
        };
      }
    }

    return { next: 'CHAIN_CONFIRMED' as GenerationRunState };
  },

  CHAIN_CONFIRMED: async (ctx) => {
    const marketId = ctx.run.marketId;
    if (!marketId) throw new AppError(500, 'MISSING_MARKET_ID', 'Run has no marketId');

    const market = await prisma.market.findUnique({ where: { id: marketId } });
    if (!market) throw new AppError(404, 'MARKET_NOT_FOUND', `Market ${marketId} not found`);

    // Check if trace already exists for this run or market creation
    if (ctx.outputs.traceId && ctx.outputs.tracePayload) {
      return { next: 'TRACE_PERSISTED' as GenerationRunState };
    }

    const existingTrace = await prisma.reasoningTrace.findFirst({
      where: { marketId, decisionType: 'MARKET_CREATION' },
    });

    if (existingTrace) {
      return {
        outputs: {
          traceId: existingTrace.id,
          tracePayload: (existingTrace as any).tracePayload || undefined,
        },
        next: 'TRACE_PERSISTED' as GenerationRunState,
      };
    }

    const traceId = ctx.outputs.traceId || crypto.randomUUID();
    const traceResult = await generateReasoningTrace({
      traceId,
      marketId,
      agentType: 'MARKET_MAKER',
      decisionType: 'MARKET_CREATION',
      sourcesUsed: [
        { source: 'ORACLEDESK_AI', weight: 1.0, signal: market.question, rawValue: market.initialYesProb },
      ],
      probabilityEstimate: market.initialYesProb,
      marketProbability: 0.5,
      edge: parseFloat((market.initialYesProb - 0.5).toFixed(4)),
      confidenceInterval: (market.confidenceInterval as any) || { lower: 0.4, upper: 0.6 },
      onChainMarketId: ctx.outputs.onChainMarketId ?? market.onChainMarketId,
    });

    return {
      outputs: {
        traceId: traceResult.trace.id,
        tracePayload: traceResult.tracePayload,
      },
      next: 'TRACE_PERSISTED' as GenerationRunState,
    };
  },

  TRACE_PERSISTED: async (ctx) => {
    const traceId = ctx.outputs.traceId;
    if (!traceId) throw new AppError(500, 'MISSING_TRACE_ID', 'Run has no traceId');

    const payload = ctx.outputs.tracePayload;
    if (!payload) throw new AppError(500, 'MISSING_TRACE_PAYLOAD', 'Run has no tracePayload');

    const onChainMktId = ctx.outputs.onChainMarketId ? BigInt(ctx.outputs.onChainMarketId) : null;
    const pinned = await pinTrace({
      traceId,
      payload,
      action: 'create_market',
      onChainMarketId: onChainMktId,
    });

    return {
      outputs: {
        traceCid: pinned.cid,
        traceHash: pinned.traceHash,
      },
      next: 'TRACE_PINNED' as GenerationRunState,
    };
  },

  TRACE_PINNED: async (ctx) => {
    const traceId = ctx.outputs.traceId;
    if (!traceId) throw new AppError(500, 'MISSING_TRACE_ID', 'Run has no traceId');

    const onChainMktIdStr = ctx.outputs.onChainMarketId;
    if (!onChainMktIdStr) {
      // Dry run or off-chain only: completed
      return { next: 'COMPLETED' as GenerationRunState };
    }

    const onChainMktId = BigInt(onChainMktIdStr);
    const traceCid = ctx.outputs.traceCid;
    const traceHash = ctx.outputs.traceHash;

    if (!traceCid || !traceHash) {
      throw new AppError(500, 'MISSING_TRACE_PIN_INFO', 'Trace CID or Hash missing');
    }

    const pubResult = await publishPinnedTrace({
      traceId,
      onChainMarketId: onChainMktId,
      action: 'create_market',
      ipfsCid: traceCid,
      traceHash,
    });

    return {
      outputs: {
        onChainTraceId: pubResult.onChainTraceId ? pubResult.onChainTraceId.toString() : null,
        traceTxHash: pubResult.publishTxHash,
      },
      next: 'COMPLETED' as GenerationRunState,
    };
  },
};

// ─── Saga Service APIs ─────────────────────────────────────────────────────────

export async function startRun(
  trigger: 'cron' | 'admin' | 'resume',
  initialInputs: any = {},
): Promise<string> {
  const run = await prisma.marketGenerationRun.create({
    data: {
      trigger,
      state: 'STARTED',
      inputs: initialInputs,
      outputs: { v: 1 },
    },
  });
  return run.id;
}

export async function claimRun(
  runId: string,
  workerId: string,
  lockDurationMs = 300_000,
): Promise<MarketGenerationRun | null> {
  const now = new Date();
  const lockUntil = new Date(now.getTime() + lockDurationMs);

  const updatedCount = await prisma.marketGenerationRun.updateMany({
    where: {
      id: runId,
      state: { notIn: ['COMPLETED', 'SKIPPED', 'NEEDS_ATTENTION', 'CANCELLED'] },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
    },
    data: {
      lockedBy: workerId,
      lockedUntil: lockUntil,
    },
  });

  if (updatedCount.count === 0) return null;
  return prisma.marketGenerationRun.findUnique({ where: { id: runId } });
}

export async function advance(
  runId: string,
  opts?: { maxSteps?: number; workerId?: string },
): Promise<MarketGenerationRun> {
  const workerId = opts?.workerId || `worker-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  let currentRun = await claimRun(runId, workerId);

  if (!currentRun) {
    const existing = await prisma.marketGenerationRun.findUnique({ where: { id: runId } });
    if (!existing) throw new AppError(404, 'RUN_NOT_FOUND', `Run ${runId} not found`);
    return existing;
  }

  const maxSteps = opts?.maxSteps ?? 50;
  let stepsTaken = 0;

  try {
    while (stepsTaken < maxSteps) {
      if (['COMPLETED', 'SKIPPED', 'NEEDS_ATTENTION', 'CANCELLED'].includes(currentRun.state)) {
        break;
      }

      const stepFn = STEPS[currentRun.state];
      if (!stepFn) {
        logger.error({ state: currentRun.state }, 'No step handler for state');
        break;
      }

      // Check test fault hook
      const faultHook = sagaFaultHooks.get(currentRun.state);
      if (faultHook) {
        await faultHook(currentRun);
      }

      const ctx: RunContext = {
        run: currentRun,
        inputs: (currentRun.inputs as any) || {},
        outputs: ((currentRun.outputs as any) || { v: 1 }) as RunOutputs,
      };

      try {
        const result = await stepFn(ctx);

        const newInputs = result.inputs ? result.inputs : ctx.inputs;
        const newOutputs = { ...ctx.outputs, ...(result.outputs || {}) };

        currentRun = await prisma.marketGenerationRun.update({
          where: { id: runId },
          data: {
            state: result.next,
            inputs: newInputs,
            outputs: newOutputs,
            marketId: result.marketId ?? currentRun.marketId,
            lastError: null,
            attempts: 0,
            nextAttemptAt: null,
          },
        });
      } catch (err: any) {
        const attempts = currentRun.attempts + 1;
        const isPermanent =
          attempts >= config.SAGA_MAX_ATTEMPTS ||
          err.code === 'IPFS_NOT_CONFIGURED' ||
          err.message?.includes('TradeCapExceeded') ||
          err.message?.includes('DailyCapExceeded');

        const nextState: GenerationRunState = isPermanent ? 'NEEDS_ATTENTION' : currentRun.state;
        const backoffMs = Math.min(Math.pow(2, attempts) * 30_000, 3_600_000);
        const nextAttemptAt = isPermanent ? null : new Date(Date.now() + backoffMs);

        currentRun = await prisma.marketGenerationRun.update({
          where: { id: runId },
          data: {
            state: nextState,
            attempts,
            nextAttemptAt,
            lastError: {
              step: currentRun.state,
              message: err.message,
              code: err.code || err.name,
            },
          },
        });
        break;
      }

      stepsTaken++;
    }
  } finally {
    // Release lock
    await prisma.marketGenerationRun.updateMany({
      where: { id: runId, lockedBy: workerId },
      data: { lockedBy: null, lockedUntil: null },
    }).catch(() => {});
  }

  return currentRun;
}

export async function resumeIncomplete(limit = 5): Promise<number> {
  const now = new Date();
  const candidates = await prisma.marketGenerationRun.findMany({
    where: {
      state: { notIn: ['COMPLETED', 'SKIPPED', 'NEEDS_ATTENTION', 'CANCELLED'] },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      AND: [{ OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] }],
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });

  let processed = 0;
  for (const c of candidates) {
    try {
      await advance(c.id, { maxSteps: 50 });
      processed++;
    } catch (err: any) {
      logger.warn({ runId: c.id, err: err.message }, 'Error resuming incomplete run');
    }
  }
  return processed;
}

export async function cancelRun(runId: string, reason = 'Admin cancelled'): Promise<MarketGenerationRun> {
  const run = await prisma.marketGenerationRun.findUnique({ where: { id: runId } });
  if (!run) throw new AppError(404, 'RUN_NOT_FOUND', `Run ${runId} not found`);

  const preChainStates: GenerationRunState[] = [
    'STARTED',
    'SIGNALS_READY',
    'PROPOSED',
    'MARKET_PERSISTED',
    'QUESTION_PINNED',
    'NEEDS_ATTENTION',
  ];

  if (!preChainStates.includes(run.state)) {
    throw new AppError(400, 'CANNOT_CANCEL_ON_CHAIN', 'Cannot cancel run after chain submission');
  }

  return prisma.$transaction(async (tx) => {
    if (run.marketId) {
      const market = await tx.market.findUnique({ where: { id: run.marketId } });
      if (market && market.status === 'PENDING') {
        await tx.market.update({
          where: { id: market.id },
          data: { status: 'CANCELLED' },
        });

        await tx.agentLog.create({
          data: {
            agentType: 'MARKET_MAKER',
            action: 'MARKET_CANCELLED',
            marketId: market.id,
            details: { reason, runId },
          },
        });
      }
    }

    return tx.marketGenerationRun.update({
      where: { id: runId },
      data: {
        state: 'CANCELLED',
        lastError: { reason },
      },
    });
  });
}
