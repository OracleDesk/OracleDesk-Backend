"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateReasoningTrace = generateReasoningTrace;
exports.calculateEdge = calculateEdge;
exports.calculateConfidenceInterval = calculateConfidenceInterval;
const prisma_1 = require("../lib/prisma");
const llm_1 = require("../lib/llm"); // ← Unified LLM (Claude → Gemini fallback)
const logger_1 = require("../lib/logger");
const hash_util_1 = require("../utils/hash.util");
const zod_1 = require("zod");
// ─── Zod schema for LLM hedge condition output ───────────────────────────────
const traceReasoningSchema = zod_1.z.object({
    hedge_conditions: zod_1.z.array(zod_1.z.string()),
    reasoning_summary: zod_1.z.string().min(10),
    key_signals: zod_1.z.array(zod_1.z.string()),
    risk_factors: zod_1.z.array(zod_1.z.string()),
});
/**
 * Generates a full structured reasoning trace for an agent decision.
 *
 * Flow:
 * 1. Compute edge  (agent prob − market prob)
 * 2. Compute 90% confidence interval via jackknife sampling
 * 3. Call Claude/Gemini to generate hedge conditions and reasoning narrative
 * 4. SHA-256 hash the full trace payload for on-chain commitment
 * 5. Persist to DB (IPFS CID added later by ipfs.service.ts)
 */
async function generateReasoningTrace(input) {
    const edge = calculateEdge(input.probabilityEstimate, input.marketProbability);
    const ci = calculateConfidenceInterval(input.sourcesUsed, input.probabilityEstimate);
    const hedgeConditions = await generateHedgeConditions(input, edge, ci);
    const tracePayload = {
        agentType: input.agentType,
        decisionType: input.decisionType,
        marketId: input.marketId,
        sourcesUsed: input.sourcesUsed,
        probabilityEstimate: input.probabilityEstimate,
        marketProbability: input.marketProbability,
        edge,
        confidenceInterval: ci,
        betFraction: input.betFraction,
        betSizeUsdc: input.betSizeUsdc,
        hedgeConditions: hedgeConditions.conditions,
        agentWallet: input.agentWallet,
        timestamp: new Date().toISOString(),
    };
    const sha256Hash = (0, hash_util_1.sha256Json)(tracePayload);
    const previewSources = input.sourcesUsed.slice(0, 2);
    const trace = await prisma_1.prisma.reasoningTrace.create({
        data: {
            marketId: input.marketId,
            agentType: input.agentType,
            decisionType: input.decisionType,
            sourcesUsed: input.sourcesUsed,
            probabilityEstimate: input.probabilityEstimate,
            marketProbability: input.marketProbability,
            edge,
            confidenceInterval: ci,
            betFraction: input.betFraction,
            betSizeUsdc: input.betSizeUsdc,
            hedgeConditions: hedgeConditions.conditions,
            agentWallet: input.agentWallet,
            sha256Hash,
            previewSources: previewSources,
            verified: false,
            isPublic: false,
        },
    });
    logger_1.logger.info({ traceId: trace.id, edge, marketId: input.marketId }, 'Reasoning trace generated');
    return { trace, sha256Hash, tracePayload };
}
/**
 * Edge = agent probability − market implied probability.
 *
 * edge > 0.08  → market under-prices YES → agent bets YES
 * edge < -0.08 → market over-prices YES  → agent bets NO
 * |edge| < 0.08 → no actionable mispricing
 */
function calculateEdge(agentProb, marketProb) {
    return parseFloat((agentProb - marketProb).toFixed(4));
}
/**
 * Jackknife 90% confidence interval.
 */
function calculateConfidenceInterval(signals, centralEstimate) {
    if (signals.length < 2) {
        return {
            lower: Math.max(0.01, centralEstimate - 0.10),
            upper: Math.min(0.99, centralEstimate + 0.10),
        };
    }
    const jackknife = [];
    for (let i = 0; i < signals.length; i++) {
        const subset = signals.filter((_, idx) => idx !== i);
        const totalW = subset.reduce((acc, s) => acc + s.weight, 0);
        if (totalW === 0)
            continue;
        const signal = signals[i];
        const leaveOneOut = (centralEstimate * (totalW + signal.weight) -
            (signal.rawValue ?? centralEstimate) * signal.weight) /
            totalW;
        jackknife.push(Math.min(0.99, Math.max(0.01, leaveOneOut)));
    }
    if (jackknife.length === 0) {
        return {
            lower: Math.max(0.01, centralEstimate - 0.10),
            upper: Math.min(0.99, centralEstimate + 0.10),
        };
    }
    jackknife.sort((a, b) => a - b);
    const lowerIdx = Math.floor(0.05 * jackknife.length);
    const upperIdx = Math.ceil(0.95 * jackknife.length) - 1;
    return {
        lower: jackknife[lowerIdx] ?? centralEstimate - 0.08,
        upper: jackknife[upperIdx] ?? centralEstimate + 0.08,
    };
}
/**
 * Uses Claude/Gemini to generate specific, measurable hedge conditions.
 *
 * This is a secondary LLM call after market creation. It is intentionally
 * non-blocking: if the LLM call fails for any reason (quota, timeout, etc.)
 * we return safe defaults so the market creation cycle always completes.
 */
async function generateHedgeConditions(input, edge, ci) {
    const systemPrompt = `You are a quantitative prediction market risk manager.
Generate specific, measurable hedge conditions for a trading position.
Return ONLY a valid JSON object matching this schema exactly. No markdown, no preamble.
{
  "hedge_conditions": ["string"],
  "reasoning_summary": "string",
  "key_signals": ["string"],
  "risk_factors": ["string"]
}`;
    const userPrompt = `
Market ID:          ${input.marketId}
Agent Type:         ${input.agentType}
Decision:           ${input.decisionType}
Agent Probability:  ${input.probabilityEstimate}
Market Probability: ${input.marketProbability}
Edge:               ${edge}
CI:                 ${ci.lower.toFixed(3)} – ${ci.upper.toFixed(3)}
Bet Fraction:       ${input.betFraction ?? 'N/A'}

Top signals driving this decision:
${input.sourcesUsed
        .slice(0, 3)
        .map(s => `  - ${s.source} (weight ${s.weight}): ${s.signal}`)
        .join('\n')}

Write 3–5 specific, measurable conditions that would invalidate this trade thesis
and trigger an early close. Focus on data changes, not price changes.
`;
    try {
        const cleaned = await (0, llm_1.callLLMJSON)(systemPrompt, userPrompt, 1024);
        const parsed = JSON.parse(cleaned);
        const validated = traceReasoningSchema.parse(parsed);
        return { conditions: validated.hedge_conditions, reasoning: validated.reasoning_summary };
    }
    catch (err) {
        // Non-fatal: log a warning but never fail the whole market creation cycle
        logger_1.logger.warn({ err }, 'LLM hedge condition generation failed — applying safe defaults');
        return {
            conditions: [
                `Close if market probability rises above ${(input.probabilityEstimate + 0.10).toFixed(2)}`,
                `Close if primary signal source reverses direction`,
                `Hard stop-loss at 15% adverse market move`,
            ],
            reasoning: 'Default hedge conditions applied — LLM call failed',
        };
    }
}
