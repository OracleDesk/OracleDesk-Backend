"use strict";
/** @format */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateMarketQuestion = generateMarketQuestion;
exports.validateMarketQuestion = validateMarketQuestion;
exports.calculateProbability = calculateProbability;
exports.generateExpiryDate = generateExpiryDate;
exports.createMarketFromProposal = createMarketFromProposal;
exports.isDuplicateMarket = isDuplicateMarket;
const zod_1 = require("zod");
const prisma_1 = require("../lib/prisma");
const llm_1 = require("../lib/llm");
const logger_1 = require("../lib/logger");
const client_1 = require("@prisma/client");
const error_middleware_1 = require("../middlewares/error.middleware");
const dayjs_1 = __importDefault(require("dayjs"));
// ─── Zod schema for Gemini's JSON output ─────────────────────────────────────
const marketProposalSchema = zod_1.z.object({
    market_question: zod_1.z.string().min(10),
    initial_yes_probability: zod_1.z.number().min(0.01).max(0.99),
    resolution_oracle: zod_1.z.string().min(1),
    expiry_timestamp: zod_1.z.number().int().positive(),
    settlement_currency: zod_1.z.enum(["USDC", "EURC"]),
    minimum_liquidity_usdc: zod_1.z.number().positive(),
    category: zod_1.z.enum([
        "FED", "ECB", "ELECTION", "GEOPOLITICAL",
        "CRYPTO", "MACRO", "SPORTS", "ENTERTAINMENT", "POLITICS",
    ]),
    confidence_interval: zod_1.z.object({ lower: zod_1.z.number(), upper: zod_1.z.number() }),
    reasoning: zod_1.z.string().min(1),
});
// ─── Source credibility weights ───────────────────────────────────────────────
const SOURCE_WEIGHTS = {
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
    SPORTRADAR: 0.9,
    ESPN: 0.8,
    BBC_SPORT: 0.8,
    SPORTS_REFERENCE: 0.85,
    ENTERTAINMENT_WEEKLY: 0.6,
    BILLBOARD: 0.75,
    BOX_OFFICE_MOJO: 0.80,
    ROTTEN_TOMATOES: 0.70,
    POLITICAL_WIRE: 0.80,
    REALCLEARPOLITICS: 0.75,
    POLITICO: 0.80,
    AP_POLITICS: 0.90,
};
/**
 * Generates a validated binary prediction market proposal from signal data.
 *
 * Calls callLLMJSON (Claude → Gemini fallback) which forces clean JSON output.
 * If ANTHROPIC_API_KEY is set, Claude handles the call. Otherwise it falls
 * back to Gemini. The circuit breaker in gemini.ts fast-fails Gemini calls
 * when the daily quota is exhausted so the cycle aborts cleanly.
 */
async function generateMarketQuestion(signals) {
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
    // Fetch existing active/pending market questions so the LLM never re-generates them
    const existingMarkets = await prisma_1.prisma.market.findMany({
        where: { status: { in: ['PENDING', 'ACTIVE'] } },
        select: { question: true, category: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
    });
    const existingQuestionsBlock = existingMarkets.length > 0
        ? `\nALREADY EXISTING MARKETS (DO NOT create similar markets on these topics):\n` +
            existingMarkets
                .map((m, i) => `  ${i + 1}. [${m.category}] ${m.question}`)
                .join('\n') +
            '\n'
        : '';
    const now = (0, dayjs_1.default)();
    const userPrompt = `
Current date: ${now.toISOString()}
${existingQuestionsBlock}
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
IMPORTANT: You MUST create a market on a DIFFERENT topic from the existing markets listed above.
If all FED/rate questions are already covered, pick a different category entirely (MACRO, GEOPOLITICAL, CRYPTO, SPORTS, POLITICS, ENTERTAINMENT, etc).
Choose the most actionable, near-term, verifiable event that is NOT already covered.
Pick the category and currency that best fits the event.
`;
    let rawResponse;
    try {
        rawResponse = await (0, llm_1.callLLMJSON)(systemPrompt, userPrompt, 4096);
    }
    catch (err) {
        await logAgentAction('MARKET_MAKER', 'ERROR', 'GENERATE_QUESTION_LLM_FAIL', null, {
            error: String(err),
            signalCount: signals.signalCount,
        });
        throw new error_middleware_1.AppError(500, 'LLM_CALL_FAILED', 'LLM API call failed during market generation');
    }
    return validateMarketQuestion(rawResponse);
}
/**
 * Validates and parses Gemini's JSON output against the Zod schema.
 *
 * Even with `responseMimeType: 'application/json'`, we validate with Zod to
 * catch semantic errors (wrong field types, out-of-range probabilities) that
 * JSON validity alone won't catch.
 */
function validateMarketQuestion(rawLlmOutput) {
    const cleaned = rawLlmOutput
        .replace(/```json\n?/gi, '')
        .replace(/```\n?/g, '')
        .trim();
    let parsed;
    try {
        parsed = JSON.parse(cleaned);
    }
    catch {
        throw new error_middleware_1.AppError(422, 'INVALID_LLM_JSON', 'Gemini returned non-parseable JSON', {
            rawOutput: cleaned.slice(0, 500),
        });
    }
    const result = marketProposalSchema.safeParse(parsed);
    if (!result.success) {
        throw new error_middleware_1.AppError(422, 'SCHEMA_VALIDATION_FAILED', 'Gemini output failed schema validation', {
            errors: result.error.flatten().fieldErrors,
            rawOutput: cleaned.slice(0, 500),
        });
    }
    const { initial_yes_probability: p, confidence_interval: ci } = result.data;
    if (ci.lower >= ci.upper || p < ci.lower || p > ci.upper) {
        throw new error_middleware_1.AppError(422, 'INVALID_CONFIDENCE_INTERVAL', 'Probability must be within the confidence interval bounds', { p, ci });
    }
    return result.data;
}
/**
 * Computes a weighted probability estimate from a list of signals.
 */
function calculateProbability(signals, baseMarketPrice) {
    if (signals.length === 0) {
        return {
            probability: baseMarketPrice,
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
    const values = signals.map(s => s.rawValue ?? baseMarketPrice);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    const ci = {
        lower: Math.max(0.01, probability - 1.96 * stdDev),
        upper: Math.min(0.99, probability + 1.96 * stdDev),
    };
    return { probability, confidenceInterval: ci };
}
/**
 * Derives a sensible expiry date from the market category.
 */
function generateExpiryDate(category) {
    const base = (0, dayjs_1.default)();
    switch (category) {
        case 'FED': return base.add(30, 'day').toDate();
        case 'ECB': return base.add(30, 'day').toDate();
        case 'ELECTION': return base.add(90, 'day').toDate();
        case 'GEOPOLITICAL': return base.add(14, 'day').toDate();
        case 'CRYPTO': return base.add(7, 'day').toDate();
        case 'MACRO': return base.add(21, 'day').toDate();
        case 'SPORTS': return base.add(14, 'day').toDate();
        case 'ENTERTAINMENT': return base.add(30, 'day').toDate();
        case 'POLITICS': return base.add(30, 'day').toDate();
        default: return base.add(21, 'day').toDate();
    }
}
/**
 * Persists a validated MarketProposal to the database.
 */
async function createMarketFromProposal(proposal) {
    const upperCategory = String(proposal.category).toUpperCase();
    const finalCategory = Object.values(client_1.MarketCategory).includes(upperCategory)
        ? upperCategory
        : client_1.MarketCategory.MACRO;
    const market = await prisma_1.prisma.market.create({
        data: {
            question: proposal.market_question,
            category: finalCategory,
            status: "PENDING",
            settlementCurrency: proposal.settlement_currency,
            initialYesProb: proposal.initial_yes_probability,
            currentYesProb: proposal.initial_yes_probability,
            confidenceInterval: proposal.confidence_interval,
            expiryTimestamp: new Date(proposal.expiry_timestamp * 1000),
            resolutionOracle: proposal.resolution_oracle,
            minimumLiquidity: proposal.minimum_liquidity_usdc,
        },
    });
    await logAgentAction("MARKET_MAKER", "INFO", "MARKET_CREATED", market.id, {
        question: market.question,
        probability: market.initialYesProb,
        oracle: market.resolutionOracle,
        category: market.category,
    });
    logger_1.logger.info({ marketId: market.id, question: market.question, category: market.category }, "Market created");
    return market;
}
/**
 * Check if a similar market already exists to avoid duplicates.
 *
 * Two-pass check:
 *  1. Word-overlap Jaccard similarity (threshold 0.55 — tighter than before)
 *  2. Key-entity phrase overlap: if 3+ meaningful n-grams match, treat as duplicate
 *     even when overall word overlap is lower (catches paraphrase variants like
 *     "hold…unchanged" vs "keep…unchanged" vs "remain at").
 */
async function isDuplicateMarket(question) {
    const activeMarkets = await prisma_1.prisma.market.findMany({
        where: { status: { in: ['PENDING', 'ACTIVE'] } },
        select: { question: true },
    });
    // Stop-words to exclude from meaningful token comparison
    const STOP_WORDS = new Set([
        'the', 'a', 'an', 'is', 'are', 'will', 'at', 'or', 'by', 'in', 'on', 'of', 'to',
        'and', 'be', 'for', 'its', 'this', 'that', 'it', 'as', 'with', 'from', 'at',
        'whether', 'if', 'has', 'have', 'been', 'was', 'were', 'not', 'no',
    ]);
    function meaningfulTokens(text) {
        return text
            .toLowerCase()
            .replace(/[^a-z0-9%.\s]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 2 && !STOP_WORDS.has(w));
    }
    const newTokens = meaningfulTokens(question);
    const newTokensSet = new Set(newTokens);
    for (const m of activeMarkets) {
        const existingTokens = meaningfulTokens(m.question);
        const existingTokensSet = new Set(existingTokens);
        // Pass 1: Jaccard similarity on meaningful tokens (threshold 0.55)
        const intersection = existingTokens.filter(w => newTokensSet.has(w)).length;
        const union = new Set([...newTokens, ...existingTokens]).size;
        const jaccard = union === 0 ? 0 : intersection / union;
        if (jaccard > 0.55)
            return true;
        // Pass 2: Key-entity n-gram overlap
        // Build bigrams for both questions; if 3+ meaningful bigrams match → duplicate
        function bigrams(tokens) {
            const bg = new Set();
            for (let i = 0; i < tokens.length - 1; i++) {
                bg.add(`${tokens[i]} ${tokens[i + 1]}`);
            }
            return bg;
        }
        const newBigrams = bigrams(newTokens);
        const existingBigrams = bigrams(existingTokens);
        const bigramOverlap = [...newBigrams].filter(bg => existingBigrams.has(bg)).length;
        if (bigramOverlap >= 3)
            return true;
    }
    return false;
}
// ─── Internal helper ──────────────────────────────────────────────────────────
async function logAgentAction(agentType, level, action, marketId, data) {
    try {
        await prisma_1.prisma.agentLog.create({
            data: { agentType, level, action, marketId: marketId ?? undefined, data: data },
        });
    }
    catch (err) {
        logger_1.logger.error({ err }, "Failed to write agent log");
    }
}
