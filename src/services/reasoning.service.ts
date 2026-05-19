import { prisma } from '../lib/prisma';
import { callClaude } from '../lib/anthropic';
import { logger } from '../lib/logger';
import { sha256Json } from '../utils/hash.util';
import type {
  TraceInput,
  WeightedSignal,
  ConfidenceInterval,
} from '../types';
import { AppError } from '../middlewares/error.middleware';
import { z } from 'zod';

// ─── Zod schema for Claude's trace output ───
const traceReasoningSchema = z.object({
  hedge_conditions:  z.array(z.string()),
  reasoning_summary: z.string().min(10),
  key_signals:       z.array(z.string()),
  risk_factors:      z.array(z.string()),
});

/**
 * Generates a full, structured reasoning trace for an agent decision.
 *
 * Flow:
 * 1. Compute edge (agent prob - market prob)
 * 2. Compute 90% confidence interval from signal weights
 * 3. Call Claude to generate hedge conditions and reasoning narrative
 * 4. SHA-256 hash the full trace payload
 * 5. Persist to DB (IPFS CID is added later by ipfs.service.ts)
 */
export async function generateReasoningTrace(input: TraceInput) {
  // Step 1: Compute edge
  const edge = calculateEdge(input.probabilityEstimate, input.marketProbability);

  // Step 2: Compute confidence interval
  const ci = calculateConfidenceInterval(input.sourcesUsed, input.probabilityEstimate);

  // Step 3: Get hedge conditions from Claude
  const hedgeConditions = await generateHedgeConditions(input, edge, ci);

  // Step 4: Build the full trace payload
  const tracePayload: Record<string, unknown> = {
    agentType:           input.agentType,
    decisionType:        input.decisionType,
    marketId:            input.marketId,
    sourcesUsed:         input.sourcesUsed,
    probabilityEstimate: input.probabilityEstimate,
    marketProbability:   input.marketProbability,
    edge,
    confidenceInterval:  ci,
    betFraction:         input.betFraction,
    betSizeUsdc:         input.betSizeUsdc,
    hedgeConditions:     hedgeConditions.conditions,
    agentWallet:         input.agentWallet,
    timestamp:           new Date().toISOString(),
  };

  // Step 5: Hash the payload for on-chain commitment
  const sha256Hash = sha256Json(tracePayload);

  // Step 6: Build preview (first 2 sources = free tier)
  const previewSources = input.sourcesUsed.slice(0, 2);

  // Step 7: Persist to DB
  const trace = await prisma.reasoningTrace.create({
    data: {
      marketId:            input.marketId,
      agentType:           input.agentType,
      decisionType:        input.decisionType,
      sourcesUsed:         input.sourcesUsed as any,
      probabilityEstimate: input.probabilityEstimate,
      marketProbability:   input.marketProbability,
      edge,
      confidenceInterval:  ci,
      betFraction:         input.betFraction,
      betSizeUsdc:         input.betSizeUsdc,
      hedgeConditions:     hedgeConditions.conditions as any,
      agentWallet:         input.agentWallet,
      sha256Hash,
      previewSources:      previewSources as any,
      verified:            false,
      isPublic:            false,
    },
  });

  logger.info(
    { traceId: trace.id, edge, marketId: input.marketId },
    'Reasoning trace generated',
  );

  return { trace, sha256Hash, tracePayload };
}

/**
 * Edge = agent's probability - market's implied probability.
 *
 * Interpretation:
 *   edge > 0.08 → The market is underpricing YES — agent bets YES
 *   edge < -0.08 → The market is overpricing YES — agent bets NO
 *   |edge| < 0.08 → No actionable opportunity
 */
export function calculateEdge(agentProb: number, marketProb: number): number {
  return parseFloat((agentProb - marketProb).toFixed(4));
}

/**
 * Computes a 90% confidence interval using weighted jackknife sampling.
 *
 * For each signal, we compute what the probability would be WITHOUT that signal.
 * The spread of those leave-one-out estimates gives us our uncertainty range.
 * This is more robust than a simple ± std_dev because it accounts for
 * signal heterogeneity (some sources are much more reliable than others).
 */
export function calculateConfidenceInterval(
  signals: WeightedSignal[],
  centralEstimate: number,
): ConfidenceInterval {
  if (signals.length < 2) {
    // Not enough signals for meaningful CI — use ±10% around estimate
    return {
      lower: Math.max(0.01, centralEstimate - 0.10),
      upper: Math.min(0.99, centralEstimate + 0.10),
    };
  }

  const jackknife: number[] = [];

  for (let i = 0; i < signals.length; i++) {
    const subset = signals.filter((_, idx) => idx !== i);
    const totalW = subset.reduce((acc, s) => acc + s.weight, 0);
    if (totalW === 0) continue;

    const base = centralEstimate;
    const signal = signals[i];
    // Leave-one-out estimate: remove this signal's contribution
    const leaveOneOut =
      (base * (totalW + signal.weight) - (signal.rawValue ?? base) * signal.weight) /
      totalW;
    jackknife.push(Math.min(0.99, Math.max(0.01, leaveOneOut)));
  }

  if (jackknife.length === 0) {
    return { lower: Math.max(0.01, centralEstimate - 0.10), upper: Math.min(0.99, centralEstimate + 0.10) };
  }

  jackknife.sort((a, b) => a - b);

  // 5th percentile and 95th percentile = 90% confidence interval
  const lowerIdx = Math.floor(0.05 * jackknife.length);
  const upperIdx = Math.ceil(0.95 * jackknife.length) - 1;

  return {
    lower: jackknife[lowerIdx] ?? centralEstimate - 0.08,
    upper: jackknife[upperIdx] ?? centralEstimate + 0.08,
  };
}

/**
 * Uses Claude to generate actionable hedge conditions.
 *
 * These are the "what would change my view" conditions that subscribers
 * read to understand when the trade thesis breaks down.
 */
async function generateHedgeConditions(
  input: TraceInput,
  edge: number,
  ci: ConfidenceInterval,
): Promise<{ conditions: string[]; reasoning: string }> {
  const systemPrompt = `You are a quantitative trader writing risk conditions for a prediction market position.
Return ONLY valid JSON. No markdown.
Return: { "hedge_conditions": ["string"], "reasoning_summary": "string", "key_signals": ["string"], "risk_factors": ["string"] }`;

  const userPrompt = `
Market: ${input.marketId}
Agent Type: ${input.agentType}
Decision: ${input.decisionType}
Agent Probability: ${input.probabilityEstimate}
Market Probability: ${input.marketProbability}
Edge: ${edge}
Confidence Interval: ${ci.lower} - ${ci.upper}
Bet Fraction: ${input.betFraction ?? 'N/A'}

Top Sources:
${input.sourcesUsed
  .slice(0, 3)
  .map(s => `- ${s.source} (weight: ${s.weight}): ${s.signal}`)
  .join('\n')}

Generate 3-5 specific, measurable hedge conditions that would cause closing this position early.
Focus on what data changes would invalidate the thesis.
`;

  try {
    const raw = await callClaude(systemPrompt, userPrompt, 512);
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);
    const validated = traceReasoningSchema.parse(parsed);
    return { conditions: validated.hedge_conditions, reasoning: validated.reasoning_summary };
  } catch (err) {
    logger.warn({ err }, 'Failed to generate hedge conditions from Claude — using defaults');
    return {
      conditions: [
        `Close if market probability moves above ${(input.probabilityEstimate + 0.1).toFixed(2)}`,
        `Close if primary signal source reverses`,
        `Close at 15% adverse market move`,
      ],
      reasoning: 'Default hedge conditions applied due to LLM error',
    };
  }
}