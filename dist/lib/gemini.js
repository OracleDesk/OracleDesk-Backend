"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GEMINI_MODEL = void 0;
exports.callGemini = callGemini;
exports.callGeminiJSON = callGeminiJSON;
const generative_ai_1 = require("@google/generative-ai");
const config_1 = require("../config");
const logger_1 = require("./logger");
// ─── Singleton client ─────────────────────────────────────────────────────────
const genAI = new generative_ai_1.GoogleGenerativeAI(config_1.config.GEMINI_API_KEY);
// Best model for structured reasoning and JSON output
exports.GEMINI_MODEL = 'gemini-2.0-flash';
// ─── Helpers ──────────────────────────────────────────────────────────────────
/**
 * callGemini — general text completion.
 *
 * Use for: hedge condition generation, summaries, analysis narratives.
 * Returns raw text. Not forced to JSON.
 */
async function callGemini(systemPrompt, userPrompt, maxTokens = 2048) {
    try {
        const model = genAI.getGenerativeModel({
            model: exports.GEMINI_MODEL,
            systemInstruction: systemPrompt,
            generationConfig: {
                maxOutputTokens: maxTokens,
                temperature: 0.3,
                topP: 0.95,
            },
        });
        const result = await model.generateContent(userPrompt);
        const text = result.response.text();
        if (!text || text.trim() === '') {
            throw new Error('Gemini returned an empty text response');
        }
        return text;
    }
    catch (err) {
        logger_1.logger.error({ err: err?.message }, 'Gemini text call failed');
        throw err;
    }
}
/**
 * callGeminiJSON — forces JSON-only output.
 *
 * Use for: market generation, reasoning trace structured output.
 * `responseMimeType: 'application/json'` tells Gemini to return
 * ONLY a valid JSON object — no markdown fences, no explanatory text.
 *
 * Temperature is set to 0.1 for near-deterministic structured output.
 */
async function callGeminiJSON(systemPrompt, userPrompt, maxTokens = 2048) {
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const model = genAI.getGenerativeModel({
                model: exports.GEMINI_MODEL,
                systemInstruction: systemPrompt,
                generationConfig: {
                    responseMimeType: 'application/json',
                    maxOutputTokens: maxTokens,
                    temperature: 0.1,
                    topP: 0.90,
                },
            });
            const result = await model.generateContent(userPrompt);
            const text = result.response.text();
            if (!text || text.trim() === '') {
                throw new Error('Gemini returned empty JSON response');
            }
            const cleaned = text
                .trim()
                .replace(/^```json\s*/i, '')
                .replace(/^```\s*/i, '')
                .replace(/\s*```$/i, '')
                .trim();
            return cleaned;
        }
        catch (err) {
            lastError = err;
            logger_1.logger.warn({
                attempt,
                err: err?.message,
            }, 'Gemini JSON call failed — retrying');
            // exponential backoff
            await new Promise(resolve => setTimeout(resolve, attempt * 2000));
        }
    }
    logger_1.logger.error({ err: lastError?.message }, 'Gemini JSON call failed permanently');
    throw lastError;
}
exports.default = genAI;
