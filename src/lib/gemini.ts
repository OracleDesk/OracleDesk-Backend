import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config';
import { logger } from './logger';

// ─── Singleton client ─────────────────────────────────────────────────────────
const genAI = new GoogleGenerativeAI(config.GEMINI_API_KEY);

export const GEMINI_MODEL = 'gemini-2.0-flash';

// ─── Per-call interval guard ──────────────────────────────────────────────────
// The ingestion cron (every 15 min) and POST /markets/generate can fire at
// nearly the same time. Without a guard they both call Gemini within the same
// second, doubling RPM consumption and burning through quota twice as fast.
// A 4-second minimum interval between calls is enough to prevent this overlap.
let _lastCallAt = 0;
const MIN_CALL_INTERVAL_MS = 4_000;

async function waitForCallSlot(): Promise<void> {
  const elapsed = Date.now() - _lastCallAt;

  if (_lastCallAt > 0 && elapsed < MIN_CALL_INTERVAL_MS) {
    const wait = MIN_CALL_INTERVAL_MS - elapsed;

    logger.debug({ waitMs: wait }, 'Gemini call guard: throttling request');
    
    await new Promise(r => setTimeout(r, wait));
  }
  _lastCallAt = Date.now();
}

// ─── Circuit breaker ──────────────────────────────────────────────────────────
// When Gemini returns "limit: 0" or a daily quota exhaustion error, retrying
// is pointless — the quota won't reset until midnight UTC. The circuit breaker
// records this state and fast-fails all subsequent calls for QUOTA_COOLDOWN_MS
// so the app doesn't hammer a wall every 15 minutes.
//
// Cooldown is 1 hour by default. The cron will try again after 4 cycles (1h),
// which is useful if the user has billing set up (quota resets faster) or
// rotates to a paid key.

let _quotaExhaustedUntil = 0;
const QUOTA_COOLDOWN_MS  = 60 * 60 * 1000; // 1 hour

function isQuotaExhausted(): boolean {
  return Date.now() < _quotaExhaustedUntil;
}

function markQuotaExhausted(): void {
  _quotaExhaustedUntil = Date.now() + QUOTA_COOLDOWN_MS;
  logger.error(
    { cooldownUntil: new Date(_quotaExhaustedUntil).toISOString() },
    'Gemini daily quota exhausted — circuit breaker open. Calls will be skipped for 1 hour.',
  );
}

// Returns true when the error is a daily quota exhaustion (not just RPM)
function isDailyQuotaError(errMsg: string): boolean {
  return (
    errMsg.includes('GenerateRequestsPerDayPerProject') ||
    errMsg.includes('GenerateContentInputTokensPerModelPerMinute-FreeTier') ||
    // The free tier error says "limit: 0" on the daily quota metric
    (errMsg.includes('limit: 0') && errMsg.includes('free_tier'))
  );
}

// ─── Retry delay parser ───────────────────────────────────────────────────────
// The 429 body contains: "Please retry in 33.138887932s."
// and a RetryInfo object: "retryDelay":"33s"
//
// We respect the API's own suggestion. The original 2s/4s/6s backoff fired
// all three retries while still rate-limited and wasted every attempt.
// We add a 3s safety buffer on top of the suggested delay.
function parseRetryDelayMs(errorMessage: string): number {
  const floatMatch = errorMessage.match(/[Rr]etry in (\d+(?:\.\d+)?)s/);
  if (floatMatch) {
    return Math.ceil(parseFloat(floatMatch[1])) * 1000 + 3_000;
  }
  const jsonMatch = errorMessage.match(/"retryDelay"\s*:\s*"(\d+)s"/);
  if (jsonMatch) {
    return (parseInt(jsonMatch[1], 10) + 3) * 1000;
  }
  return 30_000; // conservative fallback
}

// ─── callGemini — plain text output ───────────────────────────────────────────
// Use for summaries, analysis narratives (non-JSON).
export async function callGemini(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 2048,
): Promise<string> {
  if (isQuotaExhausted()) {
    throw new Error(
      `Gemini quota circuit breaker is open until ${new Date(_quotaExhaustedUntil).toISOString()}. ` +
      'Add billing to your Google AI account or wait for the quota to reset.',
    );
  }

  await waitForCallSlot();

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
    const text   = result.response.text();

    if (!text || text.trim() === '') {
      throw new Error('Gemini returned an empty text response');
    }

    return text;
  } catch (err: any) {
    logger.error({ err: err?.message }, 'Gemini text call failed');
    throw err;
  }
}

// ─── callGeminiJSON — JSON-forced output ──────────────────────────────────────
// `responseMimeType: 'application/json'` tells Gemini to return ONLY valid
// JSON — no markdown fences, no explanation.
//
// Retry strategy:
//   - On 429/RESOURCE_EXHAUSTED: parse the API's own retryDelay and wait that
//     long before retrying. Max 2 retries (3 total attempts).
//   - On daily quota exhaustion: open the circuit breaker and throw immediately.
//     No point retrying when the daily cap is hit.
//   - On any other error: throw immediately (no retry).
export async function callGeminiJSON(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 2048,
): Promise<string> {

  // ── Circuit breaker check ─────────────────────────────────────────────────
  if (isQuotaExhausted()) {
    throw new Error(
      `Gemini quota circuit breaker is open until ${new Date(_quotaExhaustedUntil).toISOString()}. ` +
      'Add billing to your Google AI account or wait for the quota to reset.',
    );
  }

  await waitForCallSlot();

  let lastError: any;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const model = genAI.getGenerativeModel({
        model: GEMINI_MODEL,
        systemInstruction: systemPrompt,
        generationConfig: {
          responseMimeType: 'application/json',
          maxOutputTokens:  maxTokens,
          temperature:      0.1,
          topP:             0.90,
        },
      });

      const result = await model.generateContent(userPrompt);
      const text   = result.response.text();

      if (!text || text.trim() === '') {
        throw new Error('Gemini returned empty JSON response');
      }

      // Belt-and-suspenders strip even though responseMimeType prevents fences
      const cleaned = text
        .trim()
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

      return cleaned;

    } catch (err: any) {
      lastError = err;

      const errMsg: string = err?.message ?? String(err);
      const is429 = errMsg.includes('429') ||
                    errMsg.includes('Too Many Requests') ||
                    errMsg.includes('RESOURCE_EXHAUSTED');

      if (!is429) {
        // Not a rate-limit error — fail immediately, no retry
        break;
      }

      // ── Check for daily quota exhaustion (not just RPM) ───────────────────
      if (isDailyQuotaError(errMsg)) {
        markQuotaExhausted();
        break; // Circuit breaker opened — stop retrying now
      }

      if (attempt >= 3) break; // Out of retries

      // ── RPM limit (not daily) — wait the full suggested delay ─────────────
      const delayMs = parseRetryDelayMs(errMsg);
      logger.warn(
        { attempt, retryAfterMs: delayMs },
        `Gemini 429 (RPM) — waiting ${(delayMs / 1000).toFixed(0)}s before retry`,
      );
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  logger.error(
    { err: lastError?.message?.slice(0, 300) },
    'Gemini JSON call failed permanently',
  );

  throw lastError;
}

export default genAI;