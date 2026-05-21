import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config';
import { logger } from './logger';

// ─── Singleton client ─────────────────────────────────────────────────────────
const genAI = new GoogleGenerativeAI(config.GEMINI_API_KEY);

// Best model for structured reasoning and JSON output
export const GEMINI_MODEL = 'models/gemini-1.5-flash';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * callGemini — general text completion.
 *
 * Use for: hedge condition generation, summaries, analysis narratives.
 * Returns raw text. Not forced to JSON.
 */
export async function callGemini(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 2048,
): Promise<string> {
  try {
    const model = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
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
  } catch (err: any) {
    logger.error({ err: err?.message }, 'Gemini text call failed');
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
export async function callGeminiJSON(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 2048,
): Promise<string> {

  let lastError: any;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {

      const model = genAI.getGenerativeModel({
        model: GEMINI_MODEL,

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

    } catch (err: any) {

      lastError = err;

      logger.warn(
        {
          attempt,
          err: err?.message,
        },
        'Gemini JSON call failed — retrying',
      );

      // exponential backoff
      await new Promise(resolve =>
        setTimeout(resolve, attempt * 2000),
      );
    }
  }

  logger.error(
    { err: lastError?.message },
    'Gemini JSON call failed permanently',
  );

  throw lastError;
}

export default genAI;