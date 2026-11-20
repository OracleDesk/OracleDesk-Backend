/**
 * Dispute evaluator calibration (#247).
 *
 * Labels historical DisputeReview rows against chain-final ground truth and
 * computes reliability / false-silence statistics per slice. The calibrated
 * AGREE threshold is chosen conservatively: null with insufficient data, never
 * below DISPUTE_AGREE_MIN_CONFIDENCE.
 */
import { prisma } from '../lib/prisma';
import { withAdvisoryLock } from '../lib/advisory-lock';
import { clopperPearsonUpper } from '../lib/stats';
import { brier, logLoss, reliability } from './calibration.service';
import type { Bucket, Sample } from './calibration.service';
import { config } from '../config';
import { logger } from '../lib/logger';
import { writeAgentLog } from '../lib/agent-log';

// ─── Types ───────────────────────────────────────────────────────────────────

export type FinalOutcome = 'YES' | 'NO' | 'VOID';

export interface FalseSilencePoint {
  threshold: number;
  agreeCount: number;
  wrongAgree: number;
  upper95: number;
}

export interface EvaluatorSlice {
  key: string;
  n: number;
  nWrongProposals: number;
  reliability: Bucket[];
  brier: number;
  logLoss: number;
  falseSilence: FalseSilencePoint[];
  /** null = insufficient data for this slice */
  calibratedThreshold: number | null;
}

// ─── Labelling ────────────────────────────────────────────────────────────────

const LABEL_LOCK = 'oracledesk:dispute-calibration:label';

/**
 * Idempotent labelling job. For unlabelled reviews whose market is RESOLVED or
 * CANCELLED, derive finalOutcome and proposalCorrect from the market row and
 * sibling proposals. Runs under an advisory lock so concurrent cron ticks are
 * safe. Returns the number of rows newly labelled.
 */
export async function labelReviews(now = new Date()): Promise<number> {
  const result = await withAdvisoryLock(LABEL_LOCK, async (tx) => {
    // Load unlabelled reviews for resolved/cancelled markets.
    const reviews = await tx.disputeReview.findMany({
      where: { labelledAt: null, resolvedAs: { not: null } },
      select: {
        id: true,
        onChainMarketId: true,
        proposedOutcome: true,
        resolvedAs: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    if (reviews.length === 0) return 0;

    // Load markets referenced by these reviews.
    const marketIds = [...new Set(reviews.map((r) => r.onChainMarketId))];
    const markets = await tx.market.findMany({
      where: { onChainMarketId: { in: marketIds } },
      select: {
        onChainMarketId: true,
        status: true,
        resolvedOutcome: true,
      },
    });
    const marketByChainId = new Map(markets.map((m) => [String(m.onChainMarketId), m]));

    // Load all reviews per market to detect overturned proposals.
    const allReviews = await tx.disputeReview.findMany({
      where: { onChainMarketId: { in: marketIds } },
      select: {
        id: true,
        onChainMarketId: true,
        proposedOutcome: true,
        resolvedAs: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    const reviewsByMarket = new Map<string, typeof allReviews>();
    for (const r of allReviews) {
      const key = String(r.onChainMarketId);
      if (!reviewsByMarket.has(key)) reviewsByMarket.set(key, []);
      reviewsByMarket.get(key)!.push(r);
    }

    let labelled = 0;
    for (const review of reviews) {
      const marketKey = String(review.onChainMarketId);
      const market = marketByChainId.get(marketKey);
      if (!market) continue;

      let finalOutcome: FinalOutcome | null = null;
      let proposalCorrect: boolean | null = null;

      if (market.status === 'CANCELLED') {
        finalOutcome = 'VOID';
        proposalCorrect = false;
      } else if (market.status === 'RESOLVED') {
        finalOutcome = market.resolvedOutcome ? 'YES' : 'NO';
        if (review.resolvedAs === 'FINALIZED') {
          proposalCorrect = review.proposedOutcome === finalOutcome;
        } else if (review.resolvedAs === 'CANCELLED') {
          // Check whether a later review finalized a different outcome.
          const siblings = reviewsByMarket.get(marketKey) ?? [];
          const laterFinalized = siblings.find(
            (s) => s.id !== review.id && s.resolvedAs === 'FINALIZED' && s.createdAt > review.createdAt,
          );
          if (laterFinalized) {
            // Cancelled and replaced — this proposal was wrong.
            proposalCorrect = false;
          } else {
            // Cancelled but final outcome matches — reason unknown; leave unlabelled.
            proposalCorrect = null;
          }
        }
      }

      if (finalOutcome === null) continue;

      await tx.disputeReview.update({
        where: { id: review.id },
        data: {
          finalOutcome,
          proposalCorrect,
          labelledAt: now,
        },
      });
      labelled++;
    }

    return labelled;
  });

  if (!result.acquired) {
    logger.warn('labelReviews: could not acquire advisory lock — skipping');
    return 0;
  }

  if (result.value > 0) {
    logger.info({ labelled: result.value }, 'dispute-calibration: labelled reviews');
  }
  return result.value;
}

// ─── Statistics ───────────────────────────────────────────────────────────────

interface LabelledRow {
  confidence: number;
  independentOutcome: string | null;
  proposedOutcome: string;
  finalOutcome: string;
  proposalCorrect: boolean | null;
  evaluatorModel: string | null;
  category: string | null;
  evidenceClass: string | null;
}

function computeSlice(key: string, rows: LabelledRow[]): EvaluatorSlice {
  const target = config.DISPUTE_TARGET_FALSE_SILENCE_RATE;
  const minN   = config.DISPUTE_CALIBRATION_MIN_N;

  const eligible = rows.filter(
    (r) => r.proposalCorrect !== null && r.proposedOutcome !== 'UNKNOWN',
  );

  // Reliability / brier / log-loss: evaluator vs final outcome
  const reliabilitySamples: Sample[] = eligible
    .filter((r) => r.independentOutcome !== null && r.confidence > 0)
    .map((r) => ({
      p: r.confidence,
      o: r.independentOutcome === r.finalOutcome ? 1 : 0,
      w: 1,
    }));

  const nWrongProposals = eligible.filter((r) => r.proposalCorrect === false).length;

  // False-silence: at each threshold t, among rows where the evaluator agreed
  // (independentOutcome === proposedOutcome ∧ confidence >= t), how many have
  // proposalCorrect = false?
  const falseSilence: FalseSilencePoint[] = [];
  for (let t = 0; t <= 1; t = Math.round((t + 0.01) * 100) / 100) {
    const agreeing = eligible.filter(
      (r) =>
        r.confidence >= t &&
        r.independentOutcome === r.proposedOutcome,
    );
    const wrongAgree = agreeing.filter((r) => r.proposalCorrect === false).length;
    const upper95    = clopperPearsonUpper(wrongAgree, agreeing.length, 0.05);
    falseSilence.push({ threshold: t, agreeCount: agreeing.length, wrongAgree, upper95 });
  }

  // calibratedThreshold: smallest t where upper95 ≤ target and agreeCount ≥ minN,
  // but never below DISPUTE_AGREE_MIN_CONFIDENCE.
  let calibratedThreshold: number | null = null;
  const floor = config.DISPUTE_AGREE_MIN_CONFIDENCE;
  for (const pt of falseSilence) {
    if (pt.threshold < floor) continue;
    if (pt.agreeCount >= minN && pt.upper95 <= target) {
      calibratedThreshold = pt.threshold;
      break;
    }
  }

  return {
    key,
    n: eligible.length,
    nWrongProposals,
    reliability: reliabilitySamples.length > 0
      ? reliability(reliabilitySamples)
      : [],
    brier: reliabilitySamples.length > 0
      ? brier(reliabilitySamples)
      : NaN,
    logLoss: reliabilitySamples.length > 0
      ? logLoss(reliabilitySamples)
      : NaN,
    falseSilence,
    calibratedThreshold,
  };
}

/**
 * Compute all slices (all, category, evidenceClass, model, category×evidenceClass)
 * from labelled reviews. Pure — does not write to the database.
 */
export async function computeCalibrationSlices(): Promise<EvaluatorSlice[]> {
  const rows = await prisma.disputeReview.findMany({
    where: {
      labelledAt: { not: null },
      verdict: { not: 'ERROR' },
    },
    select: {
      confidence: true,
      independentOutcome: true,
      proposedOutcome: true,
      finalOutcome: true,
      proposalCorrect: true,
      evidenceClass: true,
      category: true,
      evaluatorProvenance: true,
    },
  });

  const mapped: LabelledRow[] = rows
    .filter((r) => r.finalOutcome !== null)
    .map((r) => ({
      confidence:         r.confidence ?? 0,
      independentOutcome: r.independentOutcome,
      proposedOutcome:    r.proposedOutcome,
      finalOutcome:       r.finalOutcome!,
      proposalCorrect:    r.proposalCorrect,
      evaluatorModel:     (r.evaluatorProvenance as { model?: string } | null)?.model ?? null,
      category:           r.category ? String(r.category) : null,
      evidenceClass:      r.evidenceClass,
    }));

  if (mapped.length === 0) return [];

  const slices: EvaluatorSlice[] = [];

  // Global
  slices.push(computeSlice('all', mapped));

  // Per category
  const categories = [...new Set(mapped.map((r) => r.category).filter(Boolean))];
  for (const cat of categories) {
    slices.push(computeSlice(`category:${cat}`, mapped.filter((r) => r.category === cat)));
  }

  // Per evidenceClass
  const evClasses = [...new Set(mapped.map((r) => r.evidenceClass).filter(Boolean))];
  for (const ec of evClasses) {
    slices.push(computeSlice(`evidenceClass:${ec}`, mapped.filter((r) => r.evidenceClass === ec)));
  }

  // Per model
  const models = [...new Set(mapped.map((r) => r.evaluatorModel).filter(Boolean))];
  for (const model of models) {
    slices.push(computeSlice(`model:${model}`, mapped.filter((r) => r.evaluatorModel === model)));
  }

  // Category × evidenceClass
  for (const cat of categories) {
    for (const ec of evClasses) {
      const subset = mapped.filter((r) => r.category === cat && r.evidenceClass === ec);
      if (subset.length > 0) {
        slices.push(computeSlice(`category:${cat}×evidenceClass:${ec}`, subset));
      }
    }
  }

  return slices;
}

/**
 * Returns the effective AGREE threshold for a given market + slice context,
 * honouring the DISPUTE_CALIBRATED_THRESHOLD mode.
 *
 * - 'off': always return DISPUTE_AGREE_MIN_CONFIDENCE.
 * - 'observe': return DISPUTE_AGREE_MIN_CONFIDENCE (logging happens at the call site).
 * - 'enforce': return max(floor, calibratedThreshold ?? 1.01).
 *   1.01 means AGREE is impossible (not calibrated for this slice).
 */
export async function effectiveAgreeThreshold(sliceKey: string): Promise<{
  threshold: number;
  source: 'floor' | 'calibrated' | 'uncalibrated';
}> {
  const floor = config.DISPUTE_AGREE_MIN_CONFIDENCE;
  if (config.DISPUTE_CALIBRATED_THRESHOLD !== 'enforce') {
    return { threshold: floor, source: 'floor' };
  }

  const slices = await computeCalibrationSlices();
  const slice = slices.find((s) => s.key === sliceKey) ?? slices.find((s) => s.key === 'all');

  if (!slice || slice.calibratedThreshold === null) {
    return { threshold: 1.01, source: 'uncalibrated' };
  }

  const t = Math.max(floor, slice.calibratedThreshold);
  return { threshold: t, source: t > floor ? 'calibrated' : 'floor' };
}

/**
 * Write a DISPUTE_CALIBRATION_SHADOW agent log in 'observe' mode — records
 * what the calibrated rule would have done without changing behaviour.
 */
export async function shadowLog(opts: {
  reviewId: string;
  currentVerdict: string;
  calibratedVerdict: string;
  sliceKey: string;
  threshold: number;
}): Promise<void> {
  await writeAgentLog({
    agentType: 'MARKET_MAKER',
    level:     'DEBUG',
    action:    'DISPUTE_CALIBRATION_SHADOW',
    data:      opts,
  }).catch(() => {});
}
