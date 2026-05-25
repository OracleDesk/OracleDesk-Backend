"use strict";
/** *
 * Provider priority:
 *   1. Anthropic Claude (claude-sonnet-4-20250514) — if ANTHROPIC_API_KEY is set in .env
 *   2. Gemini (gemini-2.0-flash)                   — automatic fallback
 *
 * Why this exists:
 *   Gemini's free tier has a hard daily quota. When that quota is exhausted,
 *   even a new API key from a new account won't help until midnight UTC —
 *   because Google tracks quota per project, not per key rotation.
 *   Claude (via @anthropic-ai/sdk, already in package.json) has a separate,
 *   generous free tier that's unaffected by Gemini's exhaustion.
 *
 *   This file lets the app route to Claude first, so Gemini is only called
 *   if Claude is unavailable. Both providers produce identical output shapes.
 *
 * Call-interval guard:
 *   Prevents the ingestion cron and a simultaneous POST /markets/generate
 *   from firing two LLM calls within the same second and burning quota twice.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.callLLMJSON = callLLMJSON;
exports.callLLMText = callLLMText;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const config_1 = require("../config");
const logger_1 = require("./logger");
const gemini_1 = require("./gemini");
const CLAUDE_MODEL = 'claude-sonnet-4-6';
// ─── Lazy Anthropic client ────────────────────────────────────────────────────
let _anthropic = null;
function getAnthropicClient() {
    if (!config_1.config.ANTHROPIC_API_KEY)
        return null;
    if (!_anthropic) {
        _anthropic = new sdk_1.default({ apiKey: config_1.config.ANTHROPIC_API_KEY });
    }
    return _anthropic;
}
// ─── Inter-call interval guard ────────────────────────────────────────────────
let _lastCallAt = 0;
const MIN_INTERVAL_MS = 5000; // 5 seconds between calls
async function waitForSlot() {
    const elapsed = Date.now() - _lastCallAt;
    if (_lastCallAt > 0 && elapsed < MIN_INTERVAL_MS) {
        const wait = MIN_INTERVAL_MS - elapsed;
        logger_1.logger.debug({ waitMs: wait }, 'LLM call guard: throttling request');
        await new Promise(r => setTimeout(r, wait));
    }
    _lastCallAt = Date.now();
}
// ─── callLLMJSON — JSON-forced output ─────────────────────────────────────────
// Tries Anthropic Claude first. Falls back to Gemini automatically.
// Returns a clean JSON string ready for JSON.parse().
async function callLLMJSON(systemPrompt, userPrompt, maxTokens = 2048) {
    await waitForSlot();
    const anthropic = getAnthropicClient();
    if (anthropic) {
        try {
            const message = await anthropic.messages.create({
                model: CLAUDE_MODEL,
                max_tokens: maxTokens,
                system: systemPrompt +
                    '\n\nCRITICAL: Your response must be ONLY a valid JSON object. ' +
                    'No markdown fences, no preamble, no explanation — pure JSON.',
                messages: [{ role: 'user', content: userPrompt }],
            });
            const block = message.content[0];
            if (block.type !== 'text' || !block.text.trim()) {
                throw new Error('Anthropic returned an empty response');
            }
            const cleaned = block.text
                .trim()
                .replace(/^```json\s*/i, '')
                .replace(/^```\s*/i, '')
                .replace(/\s*```$/i, '')
                .trim();
            logger_1.logger.debug({ model: CLAUDE_MODEL }, 'LLM call served by Anthropic Claude');
            return cleaned;
        }
        catch (err) {
            logger_1.logger.warn({ err: err?.message?.slice(0, 200) }, 'Anthropic Claude failed — falling back to Gemini');
            // Fall through to Gemini
        }
    }
    else {
        logger_1.logger.debug('ANTHROPIC_API_KEY not set — routing directly to Gemini');
    }
    logger_1.logger.debug('LLM call served by Gemini');
    return (0, gemini_1.callGeminiJSON)(systemPrompt, userPrompt, maxTokens);
}
// ─── callLLMText — plain text output ─────────────────────────────────────────
// For summaries and narratives that don't need strict JSON.
async function callLLMText(systemPrompt, userPrompt, maxTokens = 2048) {
    await waitForSlot();
    const anthropic = getAnthropicClient();
    if (anthropic) {
        try {
            const message = await anthropic.messages.create({
                model: CLAUDE_MODEL,
                max_tokens: maxTokens,
                system: systemPrompt,
                messages: [{ role: 'user', content: userPrompt }],
            });
            const block = message.content[0];
            if (block.type !== 'text' || !block.text.trim()) {
                throw new Error('Anthropic returned an empty response');
            }
            return block.text.trim();
        }
        catch (err) {
            logger_1.logger.warn({ err: err?.message?.slice(0, 200) }, 'Anthropic Claude text call failed — falling back to Gemini');
        }
    }
    return (0, gemini_1.callGeminiJSON)(systemPrompt, userPrompt, maxTokens);
}
