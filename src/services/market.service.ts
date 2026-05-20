/** @format */

import { z } from "zod";
import { prisma } from "../lib/prisma";
import { callClaude } from "../lib/anthropic";
import { logger } from "../lib/logger";
import type {
	MarketProposal,
	AggregatedSignals,
	WeightedSignal,
	ConfidenceInterval,
} from "../types";
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
	]),
	confidence_interval: z.object({ lower: z.number(), upper: z.number() }),
	reasoning: z.string().min(1),
});

// ─── Source credibility weights ───
const SOURCE_WEIGHTS: Record<string, number> = {
	FRED: 0.9,
	BLS: 0.9,
	ECB: 0.9,
	CME_FEDWATCH: 0.9,
	AP_ELECTIONS: 0.9,
	NEWSAPI: 0.7,
	GDELT: 0.6,
	ANALYST: 0.5,
	REDDIT: 0.3,
	TWITTER: 0.3,
};

/**
 * Generates a validated binary prediction market question from signal data.
 *
 * Claude is prompted to return ONLY a JSON object. The response is then
 * validated against our Zod schema. Failed generations are logged with
 * the full prompt and raw LLM response for debugging.
 */
export async function generateMarketQuestion(
	signals: AggregatedSignals,
): Promise<MarketProposal> {
	const systemPrompt = `
You are an expert prediction market creator. You analyze macro and geopolitical signals 
and generate precise, binary, verifiable prediction market questions.

Rules:
1. Questions must be 100% binary (YES or NO outcome only)
2. Resolution must be objectively verifiable via a public data source
3. Events must resolve within 1–90 days
4. Do not create vague or subjective questions
5. Return ONLY valid JSON. No preamble, no markdown, no explanation outside JSON.

Return this exact JSON structure:
{
  "market_question": "Will [specific entity] [specific action] by [specific date]?",
  "initial_yes_probability": 0.68,
  "resolution_oracle": "FRED|BLS|ECB|AP_ELECTIONS|CHAINLINK|OPEC",
  "expiry_timestamp": 1234567890,
  "settlement_currency": "USDC",
  "minimum_liquidity_usdc": 100,
  "category": "FED|ECB|ELECTION|GEOPOLITICAL|CRYPTO|MACRO",
  "confidence_interval": { "lower": 0.58, "upper": 0.78 },
  "reasoning": "Brief explanation of why this probability estimate"
}
`;

	const now = dayjs();
	const userPrompt = `
Current date: ${now.toISOString()}

Latest macro signals (last 15 minutes):

NEWS SIGNALS (${signals.news.length} items):
${signals.news
	.slice(0, 5)
	.map((s) => `- [${s.source}] ${s.title}: ${s.content.slice(0, 200)}`)
	.join("\n")}

FED/CENTRAL BANK SIGNALS (${signals.fed.length} items):
${signals.fed
	.slice(0, 5)
	.map((s) => `- [${s.source}] ${s.title}: ${s.content.slice(0, 200)}`)
	.join("\n")}

MACRO EVENTS (${signals.macro.length} items):
${signals.macro
	.slice(0, 5)
	.map((s) => `- [${s.source}] ${s.title}: ${s.content.slice(0, 200)}`)
	.join("\n")}

Generate ONE high-quality prediction market from these signals. Choose the most actionable, 
near-term, binary event. US/Americas events → USDC. EU/global events → EURC.
`;

	let rawResponse: string;
	try {
		rawResponse = await callClaude(systemPrompt, userPrompt, 1024);
	} catch (err) {
		await logAgentAction(
			"MARKET_MAKER",
			"ERROR",
			"GENERATE_QUESTION_LLM_FAIL",
			null,
			{
				error: String(err),
				signalCount: signals.signalCount,
			},
		);
		throw new AppError(
			500,
			"LLM_CALL_FAILED",
			"Claude API call failed during market generation",
		);
	}

	return validateMarketQuestion(rawResponse);
}

/**
 * Validates and parses Claude's raw JSON output.
 * Throws a detailed AppError if the output is malformed.
 */
export function validateMarketQuestion(rawLlmOutput: string): MarketProposal {
	// Strip any accidental markdown fences Claude might add
	const cleaned = rawLlmOutput
		.replace(/```json\n?/g, "")
		.replace(/```\n?/g, "")
		.trim();

	let parsed: unknown;
	try {
		parsed = JSON.parse(cleaned);
	} catch {
		throw new AppError(
			422,
			"INVALID_LLM_JSON",
			"Claude returned non-parseable JSON",
			{
				rawOutput: cleaned.slice(0, 500),
			},
		);
	}

	const result = marketProposalSchema.safeParse(parsed);
	if (!result.success) {
		throw new AppError(
			422,
			"SCHEMA_VALIDATION_FAILED",
			"Claude output failed schema validation",
			{
				errors: result.error.flatten().fieldErrors,
				rawOutput: cleaned.slice(0, 500),
			},
		);
	}

	// Extra sanity: confidence interval must contain the probability
	const { initial_yes_probability: p, confidence_interval: ci } = result.data;
	if (ci.lower >= ci.upper || p < ci.lower || p > ci.upper) {
		throw new AppError(
			422,
			"INVALID_CONFIDENCE_INTERVAL",
			"Probability must be within confidence interval",
			{ p, ci },
		);
	}

	return result.data as MarketProposal;
}

/**
 * Computes a weighted probability estimate from a list of signals.
 *
 * Each signal source has a credibility weight (0.0–1.0). The final
 * probability is the weighted mean of all signal probabilities.
 * The confidence interval is computed as mean ± 1.96 * std_dev (95% CI).
 */
export function calculateProbability(
	signals: WeightedSignal[],
	baseMarketPrice: number,
): { probability: number; confidenceInterval: ConfidenceInterval } {
	if (signals.length === 0) {
		return {
			probability: baseMarketPrice,
			confidenceInterval: {
				lower: baseMarketPrice - 0.1,
				upper: baseMarketPrice + 0.1,
			},
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

	// Compute standard deviation of signal values
	const values = signals.map((s) => s.rawValue ?? baseMarketPrice);
	const mean = values.reduce((a, b) => a + b, 0) / values.length;
	const variance =
		values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / values.length;
	const stdDev = Math.sqrt(variance);

	const ci: ConfidenceInterval = {
		lower: Math.max(0.01, probability - 1.96 * stdDev),
		upper: Math.min(0.99, probability + 1.96 * stdDev),
	};

	return { probability, confidenceInterval: ci };
}

/**
 * Derives a sensible expiry date based on market category.
 * Fed meetings → next Wednesday, ECB → next Thursday, etc.
 */
export function generateExpiryDate(category: string): Date {
	const base = dayjs();
	switch (category) {
		case "FED":
			return base.add(30, "day").toDate();
		case "ECB":
			return base.add(30, "day").toDate();
		case "ELECTION":
			return base.add(90, "day").toDate();
		case "GEOPOLITICAL":
			return base.add(14, "day").toDate();
		case "CRYPTO":
			return base.add(7, "day").toDate();
		default:
			return base.add(21, "day").toDate();
	}
}

/**
 * Persists a validated MarketProposal to the database.
 * Also writes a creation log to agent_logs.
 */
export async function createMarketFromProposal(
	proposal: MarketProposal,
): Promise<Market> {
	const market = await prisma.market.create({
		data: {
			question: proposal.market_question,
			category: proposal.category,
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
	});

	logger.info(
		{ marketId: market.id, question: market.question },
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
