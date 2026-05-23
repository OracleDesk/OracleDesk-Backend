/** @format */

import { z } from "zod";
import { prisma } from "../lib/prisma";
// import { callClaude } from "../lib/anthropic";
import { callGeminiJSON } from '../lib/gemini';  
import { logger } from "../lib/logger";
import type {
	MarketProposal,
	AggregatedSignals,
	WeightedSignal,
	ConfidenceInterval,
} from "../types";
import { Prisma, MarketCategory } from '@prisma/client'; // Make sure MarketCategory is imported
import type { Market } from "@prisma/client";
import { AppError } from "../middlewares/error.middleware";
import dayjs from "dayjs";

// ─── Zod schema for Claude's JSON output ───
const marketProposalSchema = z.object({
	market_question: z.string().min(10),
	initial_yes_probability: z.number().min(0.01).max(0.99),
	resolution_oracle: z.string().min(1),
	expiry_timestamp: z.number().int().positive(),
	settlement_currency: z.enum(["USDC", "EURC"]),
	minimum_liquidity_usdc: z.number().positive(),
	category: z.enum([
		"FED",
		"ECB",
		"ELECTION",
		"GEOPOLITICAL",
		"CRYPTO",
		"MACRO",
		"SPORTS",
		"ENTERTAINMENT",
		"POLITICS",
	]),
	confidence_interval: z.object({ lower: z.number(), upper: z.number() }),
	reasoning: z.string().min(1),
});

// ─── Source credibility weights ───
const SOURCE_WEIGHTS: Record<string, number> = {
  // Macro / Economic
  FRED:                 0.9,
  BLS:                  0.9,
  ECB:                  0.9,
  CME_FEDWATCH:         0.9,
  AP_ELECTIONS:         0.9,
  NEWSAPI:              0.7,
  GDELT:                0.6,
  ANALYST:              0.5,
  REDDIT:               0.3,
  TWITTER:              0.3,
  // Sports
  SPORTRADAR:           0.9,
  ESPN:                 0.8,
  BBC_SPORT:            0.8,
  SPORTS_REFERENCE:     0.85,
  // Entertainment
  ENTERTAINMENT_WEEKLY: 0.6,
  BILLBOARD:            0.75,
  BOX_OFFICE_MOJO:      0.80,
  ROTTEN_TOMATOES:      0.70,
  // Politics
  POLITICAL_WIRE:       0.80,
  REALCLEARPOLITICS:    0.75,
  POLITICO:             0.80,
  AP_POLITICS:          0.90,
};

/**
 * Generates a validated binary prediction market proposal from signal data.
 *
 * Calls Gemini with `callGeminiJSON` which forces clean JSON output via
 * `responseMimeType: 'application/json'`. The output is validated against
 * a Zod schema. Any LLM failure is logged with full context for debugging.
 */
export async function generateMarketQuestion(
  signals: AggregatedSignals,
): Promise<MarketProposal> {
  const systemPrompt = `
You are an expert prediction market creator for OracleDesk, an AI-powered prediction market platform.
You analyze macro, geopolitical, sports, entertainment, and political signals to create precise binary prediction markets.

RULES:
1. Questions must be 100% binary (YES or NO — no ambiguity)
2. Resolution must be objectively verifiable via a named public source
3. Markets must resolve within 1–90 days from now
4. Reject vague, subjective, or unverifiable questions
5. Return ONLY valid JSON matching the exact structure below. No other text.

REQUIRED JSON STRUCTURE:
{
  "market_question": "Will [specific entity] [specific measurable action] by [specific date]?",
  "initial_yes_probability": 0.68,
  "resolution_oracle": "FRED|BLS|ECB|AP_ELECTIONS|CHAINLINK|OPEC|ESPN|AP_POLITICS|BILLBOARD",
  "expiry_timestamp": 1234567890,
  "settlement_currency": "USDC",
  "minimum_liquidity_usdc": 100,
  "category": "FED|ECB|ELECTION|GEOPOLITICAL|CRYPTO|MACRO|SPORTS|ENTERTAINMENT|POLITICS",
  "confidence_interval": { "lower": 0.58, "upper": 0.78 },
  "reasoning": "A maximum of two sentences explaining this probability estimate"
}

CURRENCY ROUTING:
- US macro / Fed / US elections / US sports / US entertainment → USDC
- EU / ECB / EU elections / international events → EURC

CATEGORY GUIDE:
- FED: Federal Reserve rate decisions, FOMC meetings, Fed statements
- ECB: European Central Bank decisions
- ELECTION: Electoral votes, referenda, ballot measures
- GEOPOLITICAL: Wars, sanctions, treaties, international conflicts
- CRYPTO: BTC/ETH/token price thresholds, protocol upgrades, exchange events
- MACRO: Inflation, unemployment, GDP, trade data
- SPORTS: Game outcomes, championships, season milestones, player records
- ENTERTAINMENT: Award show winners, box office records, album/show milestones
- POLITICS: Political appointments, legislation passing, political party events
`;

  const now = dayjs();
  const userPrompt = `
Current date: ${now.toISOString()}

AGGREGATED SIGNALS (last 15 minutes — ${signals.signalCount} total):

NEWS (${signals.news.length} items):
${signals.news
  .slice(0, 6)
  .map(s => `  [${s.source}] ${s.title} — ${s.content.slice(0, 180)}`)
  .join('\n')}

FED / CENTRAL BANK (${signals.fed.length} items):
${signals.fed
  .slice(0, 4)
  .map(s => `  [${s.source}] ${s.title} — ${s.content.slice(0, 180)}`)
  .join('\n')}

MACRO / GEOPOLITICAL / SPORTS / POLITICS (${signals.macro.length} items):
${signals.macro
  .slice(0, 4)
  .map(s => `  [${s.source}] ${s.title} — ${s.content.slice(0, 180)}`)
  .join('\n')}

Generate ONE high-quality binary prediction market from these signals.
Choose the most actionable, near-term, verifiable event.
Pick the category and currency that best fits the event.
`;

  let rawResponse: string;
  try {
    rawResponse = await callGeminiJSON(systemPrompt, userPrompt, 4096);
  } catch (err) {
    await logAgentAction('MARKET_MAKER', 'ERROR', 'GENERATE_QUESTION_GEMINI_FAIL', null, {
      error:       String(err),
      signalCount: signals.signalCount,
    });
    throw new AppError(500, 'LLM_CALL_FAILED', 'Gemini API call failed during market generation');
  }

  return validateMarketQuestion(rawResponse);
}

/**
 * Validates and parses Gemini's JSON output.
 *
 * Even though we use `responseMimeType: 'application/json'`, we still
 * validate with Zod to catch semantic errors (wrong field types, out-of-range
 * probabilities, etc.) that JSON validity alone won't catch.
 */
export function validateMarketQuestion(rawLlmOutput: string): MarketProposal {
  // Safety strip (callGeminiJSON already strips, this is belt-and-suspenders)
  const cleaned = rawLlmOutput
    .replace(/```json\n?/gi, '')
    .replace(/```\n?/g, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new AppError(422, 'INVALID_LLM_JSON', 'Gemini returned non-parseable JSON', {
      rawOutput: cleaned.slice(0, 500),
    });
  }

  const result = marketProposalSchema.safeParse(parsed);
  if (!result.success) {
    throw new AppError(422, 'SCHEMA_VALIDATION_FAILED', 'Gemini output failed schema validation', {
      errors:    result.error.flatten().fieldErrors,
      rawOutput: cleaned.slice(0, 500),
    });
  }

  // Sanity: probability must sit inside confidence interval
  const { initial_yes_probability: p, confidence_interval: ci } = result.data;
  if (ci.lower >= ci.upper || p < ci.lower || p > ci.upper) {
    throw new AppError(422, 'INVALID_CONFIDENCE_INTERVAL',
      'Probability must be within confidence interval bounds', { p, ci });
  }

  return result.data as MarketProposal;
}

/**
 * Computes a weighted probability estimate from a list of signals.
 *
 * Each signal source has a credibility weight (0.0–1.0). The final
 * probability is the weighted mean. The confidence interval is
 * ±1.96 × std_dev (95% CI).
 */
export function calculateProbability(
  signals: WeightedSignal[],
  baseMarketPrice: number,
): { probability: number; confidenceInterval: ConfidenceInterval } {
  if (signals.length === 0) {
    return {
      probability:        baseMarketPrice,
      confidenceInterval: { lower: baseMarketPrice - 0.10, upper: baseMarketPrice + 0.10 },
    };
  }

  const weightedSum = signals.reduce((acc, s) => {
    const w = SOURCE_WEIGHTS[s.source.toUpperCase()] ?? 0.5;
    return acc + (s.rawValue ?? baseMarketPrice) * w;
  }, 0);

  const totalWeight = signals.reduce((acc, s) => {
    return acc + (SOURCE_WEIGHTS[s.source.toUpperCase()] ?? 0.5);
  }, 0);

  const probability = Math.min(0.99, Math.max(0.01, weightedSum / totalWeight));

  const values  = signals.map(s => s.rawValue ?? baseMarketPrice);
  const mean    = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / values.length;
  const stdDev   = Math.sqrt(variance);

  const ci: ConfidenceInterval = {
    lower: Math.max(0.01, probability - 1.96 * stdDev),
    upper: Math.min(0.99, probability + 1.96 * stdDev),
  };

  return { probability, confidenceInterval: ci };
}

/**
 * Derives a sensible expiry date from the market category.
 * Each category has a characteristic event horizon.
 */
export function generateExpiryDate(category: string): Date {
  const base = dayjs();
  switch (category) {
    case 'FED':           return base.add(30, 'day').toDate();
    case 'ECB':           return base.add(30, 'day').toDate();
    case 'ELECTION':      return base.add(90, 'day').toDate();
    case 'GEOPOLITICAL':  return base.add(14, 'day').toDate();
    case 'CRYPTO':        return base.add(7,  'day').toDate();
    case 'MACRO':         return base.add(21, 'day').toDate();
    case 'SPORTS':        return base.add(14, 'day').toDate(); // Next game/match window
    case 'ENTERTAINMENT': return base.add(30, 'day').toDate(); // Award shows, release windows
    case 'POLITICS':      return base.add(30, 'day').toDate(); // Legislative / appointment events
    default:              return base.add(21, 'day').toDate();
  }
}

/**
 * Persists a validated MarketProposal to the database.
 * Also writes a creation log to agent_logs.
 */
export async function createMarketFromProposal(
    proposal: MarketProposal,
): Promise<Market> {
    const upperCategory = String(proposal.category).toUpperCase();
    
    // Fall back to MACRO because it is guaranteed to exist on both old and new schemas
    const finalCategory = Object.values(MarketCategory).includes(upperCategory as MarketCategory)
        ? (upperCategory as MarketCategory)
        : MarketCategory.MACRO; 

    const market = await prisma.market.create({
        data: {
            question: proposal.market_question,
            category: finalCategory, 
            status: "PENDING",
            settlementCurrency: proposal.settlement_currency,
            initialYesProb: proposal.initial_yes_probability,
            currentYesProb: proposal.initial_yes_probability,
            confidenceInterval: proposal.confidence_interval as any,
            expiryTimestamp: new Date(proposal.expiry_timestamp * 1000),
            resolutionOracle: proposal.resolution_oracle,
            minimumLiquidity: proposal.minimum_liquidity_usdc,
        },
    });

    await logAgentAction("MARKET_MAKER", "INFO", "MARKET_CREATED", market.id, {
        question: market.question,
        probability: market.initialYesProb,
        oracle: market.resolutionOracle,
        category:    market.category,
    });

    logger.info(
        { marketId: market.id, question: market.question, category: market.category, },
        "Market created",
    );
    return market;
}

/**
 * Check if a similar market already exists to avoid duplicates.
 * Uses a simple word-overlap heuristic.
 */
export async function isDuplicateMarket(question: string): Promise<boolean> {
	const activeMarkets = await prisma.market.findMany({
		where: { status: { in: ["PENDING", "ACTIVE"] } },
		select: { question: true },
	});

	const questionWords = new Set(question.toLowerCase().split(/\s+/));

	for (const m of activeMarkets) {
		const existingWords = m.question.toLowerCase().split(/\s+/);
		const overlap = existingWords.filter((w) => questionWords.has(w)).length;
		const similarity =
			overlap / Math.max(questionWords.size, existingWords.length);
		if (similarity > 0.7) return true;
	}

	return false;
}

// ─── Internal helper ───
async function logAgentAction(
	agentType: "MARKET_MAKER" | "TRADER",
	level: "INFO" | "WARN" | "ERROR" | "DEBUG",
	action: string,
	marketId: string | null,
	data?: Record<string, unknown>,
): Promise<void> {
	try {
		await prisma.agentLog.create({
			data: { agentType, level, action, marketId: marketId ?? undefined, data: data as any },
		});
	} catch (err) {
		logger.error({ err }, "Failed to write agent log");
	}
}
