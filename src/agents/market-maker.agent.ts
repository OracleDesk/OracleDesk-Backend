import { aggregateSignals } from '../services/ingestion.service';
import {
  generateMarketQuestion,
  createMarketFromProposal,
  normalizeCategory,
  prepareResolvableProposal,
} from '../services/market.service';
import {
  reserveProposal,
  commitReservation,
  releaseReservation,
  extendLease,
} from '../services/market-reservation.service';
import { seedPolicyRecord } from '../services/seed-policy.service';
import { toDisplayUsdc } from '../lib/amounts';
import { prisma } from '../lib/prisma';
import { evidenceFromSignals, generateReasoningTrace } from '../services/reasoning.service';
import {
  assessCorroboration,
  traceCorroboration,
  uncorroboratedLogData,
  type CorroborationAssessment,
} from '../services/corroboration.service';
import { createMarketOnChain, planMarketCreation } from '../services/market-chain.service';
import { riskProvenance, snapshotMarketMaker } from '../services/risk-params.service';
import { planPriceMarket } from '../services/price-resolution.service';
import type { ResolutionSpecJson } from '../lib/resolution-spec';
import { enqueueTracePublication } from '../services/trace-publish.service';
import { TRACE_ACTIONS } from '../lib/trace-actions';
import { writeAgentLog } from '../lib/agent-log';
import { LlmBudgetExceeded, claimDailyOnce, getLlmUsage, type CallContext, type Priority } from '../lib/llm-budget';
import { logger } from '../lib/logger';
import { config } from '../config';
import { AgentPausedError, gateCycle } from '../services/agent-controls.service';
import { TransactionError } from '../services/stellar/errors';
import { deadline } from '../lib/resilience';
import { shutdownController } from '../lib/shutdown';
import { correlation, newId } from '../lib/context';
import { recordAgentDecision, type RecordAgentDecisionInput } from '../services/agent-decision.service';
import { canonicalJson, sha256Hex } from '../utils/hash.util';

// Return shape used by the job tracker
export interface MarketCycleResult {
  marketId: string;
  question: string;
  category: string;
  onChainMarketId: string | null;
}

/**
 * Market Maker Agent — main execution loop.
 * Runs via the market-maker saga state machine.
 */
export async function runMarketMakerCycle(
  opts?: { signal?: AbortSignal; priority?: Priority },
): Promise<MarketCycleResult | null> {
  const cycleId = correlation().cycleId ?? newId('cyc');
  const recordDecision = (decision: Omit<RecordAgentDecisionInput, 'cycleId' | 'agentType'>) =>
    recordAgentDecision({ ...decision, cycleId, agentType: 'MARKET_MAKER' });
  let createdMarketId: string | undefined;
  logger.info('Market Maker Agent: starting cycle');

  // Persistent kill switch / pause (#79): a paused agent is an expected state.
  try {
    await gateCycle('MARKET_MAKER');
  } catch (err) {
    if (err instanceof AgentPausedError) {
      await recordDecision({
        kind: 'MARKET_SKIP',
        reasonCode: 'AGENT_PAUSED',
        inputs: err.details,
        outcome: { status: 'SKIPPED' },
      });
      logger.info({ ...err.details }, 'Market Maker Agent: paused — skipping cycle');
      return null;
    }
    throw err;
  }

  const mmSnap = await snapshotMarketMaker();
  const mmParams = mmSnap.params;
  const mmRisk = riskProvenance(mmSnap);

  // Cron work stops at the budget minus the admin reserve; admin triggers run
  // up to the full budget (#71).
  const priority: Priority = opts?.priority ?? 'cron';
  const genCtx: CallContext = {
    purpose: priority === 'admin' ? 'admin_generation' : 'market_generation',
    priority,
  };

  const parentSignal = opts?.signal
    ? opts.signal
    : shutdownController.signal;

  const handle = deadline('rpc-write', parentSignal, config.CYCLE_DEADLINE_MS);
  const signal = handle.signal;

  try {
    signal.throwIfAborted();

    // Step 1: Aggregate signals from all sources
    const signals = await aggregateSignals(signal);
    if (signals.signalCount === 0) {
      await recordDecision({
        kind: 'MARKET_SKIP',
        reasonCode: 'NO_SIGNALS',
        inputs: { signalCount: signals.signalCount, aggregatedAt: signals.aggregatedAt },
        outcome: { status: 'SKIPPED' },
      });
      logger.warn('Market Maker Agent: no signals available — skipping cycle');
      return null;
    }

    signal.throwIfAborted();

    // Step 2: Generate market proposal via the LLM
    let proposal;
    let proposalProvenance;
    let groundingSignals;
    try {
      ({ proposal, provenance: proposalProvenance, groundingSignals } = await generateMarketQuestion(signals, genCtx));
    } catch (err) {
      if (err instanceof LlmBudgetExceeded) {
        await recordDecision({
          kind: 'MARKET_SKIP',
          reasonCode: 'LLM_BUDGET_EXCEEDED',
          inputs: { priority, details: err.details ?? {} },
          outcome: { status: 'SKIPPED' },
        });
        // One agent log per day, not one per 15-minute cycle.
        if (await claimDailyOnce('budget-exceeded')) {
          await writeAgentLog({
            agentType: 'MARKET_MAKER',
            level:     'WARN',
            action:    'LLM_BUDGET_EXCEEDED',
            data:      { priority, ...(err.details ?? {}) },
          }).catch(() => {});
        }
        logger.warn({ priority }, 'Market Maker Agent: LLM budget exhausted — skipping cycle');
        return null;
      }
      logger.error({ err }, 'Market Maker Agent: market generation failed');
      await recordDecision({
        kind: 'MARKET_SKIP',
        reasonCode: 'MARKET_GENERATION_FAILED',
        inputs: { priority, error: String(err).slice(0, 300) },
        outcome: { status: 'FAILED' },
      });
      return null;
    }

    signal.throwIfAborted();

    // Step 2b: Reject proposals the committed source can't resolve in time, or
    // repair the close time (#74). Nothing is persisted or pinned before this.
    const prepared = await prepareResolvableProposal(proposal);
    if (!prepared) {
      await recordDecision({
        kind: 'MARKET_SKIP',
        reasonCode: 'PROPOSAL_UNRESOLVABLE',
        inputs: { question: proposal.market_question, category: proposal.category },
        forecastRef: sha256Hex(canonicalJson({
          probability: proposal.initial_yes_probability,
          confidenceInterval: proposal.confidence_interval,
        })),
        outcome: { status: 'SKIPPED' },
      });
      logger.info({ question: proposal.market_question }, 'Market Maker Agent: proposal not resolvable — skipping');
      return null;
    }
    proposal = prepared.proposal;
    const resolutionDetails = prepared.resolution;

    signal.throwIfAborted();

    // Step 2c: price mode (#90). A CRYPTO proposal that names a registered
    // Reflector asset becomes a price spec, and its question is re-rendered from
    // the structured fields so text and the committed spec agree. Any problem
    // (parse, unregistered asset, dead feed, excess precision) falls back to the
    // signer spec, logged as PRICE_SPEC_FALLBACK.
    let marketSpec: ResolutionSpecJson | undefined;
    if (
      normalizeCategory(proposal.category) === 'CRYPTO' &&
      proposal.price_asset && proposal.price_threshold && proposal.price_direction && proposal.price_close_timestamp
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

    // Step 2d: cross-source corroboration (#228). The claim must be reported by
    // independent publishers or backed by an authoritative source before it is
    // reserved, persisted, pinned or seeded. `observe` logs and continues.
    let corroboration: CorroborationAssessment | null = null;
    if (config.CORROBORATION_MODE !== 'off') {
      try {
        corroboration = await assessCorroboration(proposal, groundingSignals, resolutionDetails);
      } catch (err) {
        // observe must not change behaviour; enforce fails closed.
        logger.warn({ err, mode: config.CORROBORATION_MODE }, 'Market Maker Agent: corroboration check failed');
        if (config.CORROBORATION_MODE === 'enforce') return null;
      }
    }
    if (corroboration) {
      const { verdict } = corroboration;
      if (!verdict.ok) {
        await writeAgentLog({
          agentType: 'MARKET_MAKER',
          level:     'WARN',
          action:    'PROPOSAL_UNCORROBORATED',
          data:      { mode: config.CORROBORATION_MODE, ...uncorroboratedLogData(verdict, groundingSignals) },
        }).catch(() => {});
        if (config.CORROBORATION_MODE === 'enforce') {
          logger.info({ units: verdict.detail.units, domains: verdict.detail.domains }, 'Market Maker Agent: proposal uncorroborated — skipping');
          return null;
        }
      }
      logger.info({ kind: verdict.kind, units: verdict.detail.units, mode: config.CORROBORATION_MODE }, 'Market Maker Agent: corroboration verdict');
    }

    signal.throwIfAborted();

    // Step 3: Reserve the proposal atomically (replaces bare checkDuplicate).
    // This makes dedup + insert atomic across concurrent cycles/instances (#283).
    const reservation = await reserveProposal({
      proposal,
      cycleId,
    });
    if (!reservation.ok) {
      await recordDecision({
        kind: 'MARKET_SKIP',
        reasonCode: 'DUPLICATE_PROPOSAL',
        marketId: reservation.match?.marketId,
        inputs: {
          reason: reservation.reason,
          competingReservationId: reservation.competingReservationId,
          match: reservation.match,
          question: proposal.market_question,
        },
        outcome: { status: 'SKIPPED' },
      });
      await writeAgentLog({
        agentType: 'MARKET_MAKER',
        level:     'WARN',
        action:    'DUPLICATE_SKIPPED',
        marketId:  reservation.match?.marketId,
        data:      {
          reason:                reservation.reason,
          competingReservationId: reservation.competingReservationId,
          match:                 reservation.match,
        },
      }).catch(() => {});
      logger.info(
        { reason: reservation.reason, matchedMarketId: reservation.match?.marketId },
        'Market Maker Agent: reservation rejected — skipping',
      );
      return null;
    }
    const reservationId = reservation.reservationId;

    // The rest of the cycle must release the reservation on any non-creating exit.
    try {
      signal.throwIfAborted();

      // Step 4: Seed policy. Decided before anything is written, pinned or sent:
      // when the budget does not allow a minimum seed there is no DB row, no
      // IPFS pin and no chain call.
      const decision = await planMarketCreation(
        {
          category: normalizeCategory(proposal.category),
          closeTime: new Date(proposal.expiry_timestamp * 1000),
          p: proposal.initial_yes_probability,
          ci: proposal.confidence_interval,
          llmSuggestedSeedUsdc: proposal.minimum_liquidity_usdc,
        },
        undefined,
        mmParams,
      );
      if (decision.action === 'skip') {
        await recordDecision({
          kind: 'MARKET_SKIP',
          reasonCode: 'SEED_POLICY_SKIP',
          inputs: { reason: decision.reason, question: proposal.market_question, inputs: decision.inputs },
          sizingRecord: decision.inputs,
          forecastRef: sha256Hex(canonicalJson({
            probability: proposal.initial_yes_probability,
            confidenceInterval: proposal.confidence_interval,
          })),
          outcome: { status: 'SKIPPED' },
        });
        logger.warn({ reason: decision.reason, question: proposal.market_question }, 'Market Maker Agent: seed policy skipped creation');
        await writeAgentLog({
          agentType: 'MARKET_MAKER',
          level:     'WARN',
          action:    'SEED_SKIPPED',
          data:      { reason: decision.reason, question: proposal.market_question, inputs: decision.inputs },
        }).catch(() => {});
        await releaseReservation(reservationId, 'seed-policy-skip');
        return null;
      }
      const seedPolicy = seedPolicyRecord(decision, mmRisk);
      const forecastRef = sha256Hex(canonicalJson({
        probability: proposal.initial_yes_probability,
        confidenceInterval: proposal.confidence_interval,
        signalCount: signals.signalCount,
      }));
      const decisionInputs = {
        question: proposal.market_question,
        category: normalizeCategory(proposal.category),
        probability: proposal.initial_yes_probability,
        confidenceInterval: proposal.confidence_interval,
        expiryTimestamp: proposal.expiry_timestamp,
        signalCount: signals.signalCount,
        signalIds: groundingSignals.map((signal) => signal.signalId),
        seedPolicy,
      };

      signal.throwIfAborted();

      // Extend lease before the chain call, which can be slow.
      await extendLease(reservationId).catch(() => {});

      // Step 5: Persist market to DB and commit the reservation atomically.
      let market: Awaited<ReturnType<typeof prisma.market.update>>;
      await prisma.$transaction(async (tx) => {
        const created = await createMarketFromProposal({
          ...proposal,
          initial_yes_probability: decision.pAdj,
          minimum_liquidity_usdc:  toDisplayUsdc(decision.seedRaw),
        }, proposalProvenance, resolutionDetails, tx, corroboration?.record as Record<string, unknown> | undefined);
        market = await tx.market.update({ where: { id: created.id }, data: { seedPolicy: seedPolicy as object } });
        await commitReservation(reservationId, market!.id, tx);
      });
      market = market!;
      createdMarketId = market.id;
      await recordDecision({
        kind: 'MARKET_CREATED',
        reasonCode: 'MARKET_CREATED',
        marketId: market.id,
        forecastRef,
        sizingRecord: seedPolicy,
        inputs: decisionInputs,
        outcome: { status: 'PERSISTED' },
      });
    logger.info({ marketId: market.id, category: market.category }, 'Market Maker Agent: market created in DB');

    // Step 6: Commit the resolution spec and create the market through the
    // treasury. dry-run simulates; the market then stays PENDING.
    // Note: Do not abort between a chain submission and its DB write.
    let onChainMarketId: bigint | null = null;
    try {
      const result = await createMarketOnChain(market, marketSpec, { seedRaw: decision.seedRaw, initialYesBps: decision.initialYesBps });
      if (result.mode === 'live') onChainMarketId = result.value;
    } catch (err) {
      // #40: a transient/ambiguous failure leaves the market PENDING rather than
      // FAILED; only a permanent classification would need operator repair.
      const failureClass = err instanceof TransactionError ? (err.details as { failureClass?: string } | undefined)?.failureClass : undefined;
      logger.error({ err, marketId: market.id, failureClass }, 'Market Maker Agent: on-chain creation failed; market stays PENDING');
    }

    signal.throwIfAborted();

    // Step 7: Reasoning trace for the creation decision. Evidence is what the
    // proposal cites (#73), each with its signal id and link (the top news
    // items when it cited none we can resolve), plus the corroborating signals
    // (#228), so retention keeps them and a reader can check them.
    const cited = evidenceFromSignals(groundingSignals.length > 0 ? groundingSignals : signals.news.slice(0, 3));
    const citedIds = new Set(cited.map((e) => e.signalId).filter(Boolean));
    const evidence = [...cited, ...(corroboration?.evidence ?? []).filter((e) => !citedIds.has(e.signalId))];
    const { trace, tracePayload } = await generateReasoningTrace({
      marketId:            market.id,
      agentType:           'MARKET_MAKER',
      decisionType:        'MARKET_CREATION',
      sourcesUsed:         evidence,
      probabilityEstimate: proposal.initial_yes_probability,
      marketProbability:   decision.pAdj,
      edge:                proposal.initial_yes_probability - decision.pAdj,
      confidenceInterval:  proposal.confidence_interval,
      seedPolicy,
      sourceWeightSet:     signals.weightSet,
    }, { purpose: priority === 'admin' ? 'admin_trace_hedge' : 'trace_hedge', priority }, {
      // Who proposed the market comes first in the trace's provenance (#66).
      upstreamProvenance: [proposalProvenance],
    });

    signal.throwIfAborted();

    // Step 8: Queue the trace for pinning + publication to reasoning-registry.
    // The queue publishes it once the market is on-chain (#131). The payload is
    // the validated document, unchanged (#227): the worker passes the on-chain
    // market id to publish_trace, so it never needs to be in the pinned bytes.
    try {
      await enqueueTracePublication({
        traceId: trace.id,
        payload: tracePayload,
        action: TRACE_ACTIONS.createMarket,
      });
    } catch (err) {
      logger.error({ err, traceId: trace.id }, 'Market Maker Agent: failed to queue trace publication');
    }

    await recordDecision({
      kind: 'MARKET_CREATED',
      reasonCode: 'MARKET_CREATED',
      marketId: market.id,
      traceId: trace.id,
      forecastRef,
      sizingRecord: seedPolicy,
      inputs: decisionInputs,
      outcome: {
        status: 'CREATED',
        onChainMarketId: onChainMarketId?.toString() ?? null,
        traceId: trace.id,
      },
    });

    logger.info({ marketId: market.id, traceId: trace.id }, 'Market Maker Agent: cycle complete');
    await getLlmUsage()
      .then((usage) => logger.info({ usage }, 'LLM usage after cycle'))
      .catch(() => undefined);

    return {
      marketId: market.id,
      question: market.question,
      category: String(market.category),
      onChainMarketId: onChainMarketId?.toString() ?? null,
    };
    } catch (innerErr) {
      // Any exit before market creation releases the reservation.
      await releaseReservation(reservationId, String(innerErr)).catch(() => {});
      throw innerErr;
    }
  } catch (err) {
    logger.error({ err }, 'Market Maker Agent: unhandled cycle error');

    await recordDecision({
      kind: 'MARKET_SKIP',
      reasonCode: 'CYCLE_FAILED',
      marketId: createdMarketId,
      inputs: { error: String(err).slice(0, 300) },
      outcome: { status: 'FAILED' },
    });

    await writeAgentLog({
      agentType: 'MARKET_MAKER',
      level:     'ERROR',
      action:    'CYCLE_FAILED',
      error:     String(err),
    }).catch(() => {});

    throw err; // Re-throw so the job tracker records FAILED status
  } finally {
    handle.cleanup?.();
  }
}
