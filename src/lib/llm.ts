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

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { logger } from './logger';
import { callGeminiJSON } from './gemini';

const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

// ─── Lazy Anthropic client ────────────────────────────────────────────────────
let _anthropic: Anthropic | null = null;

function getAnthropicClient(): Anthropic | null {
  if (!config.ANTHROPIC_API_KEY) return null;
  if (!_anthropic) {
    _anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  }
  return _anthropic;
}

// ─── Inter-call interval guard ────────────────────────────────────────────────
let _lastCallAt = 0;
const MIN_INTERVAL_MS = 5_000; // 5 seconds between calls

async function waitForSlot(): Promise<void> {
  const elapsed = Date.now() - _lastCallAt;
  if (_lastCallAt > 0 && elapsed < MIN_INTERVAL_MS) {
    const wait = MIN_INTERVAL_MS - elapsed;
    logger.debug({ waitMs: wait }, 'LLM call guard: throttling request');
    await new Promise(r => setTimeout(r, wait));
  }
  _lastCallAt = Date.now();
}

// ─── callLLMJSON — JSON-forced output ─────────────────────────────────────────
// Tries Anthropic Claude first. Falls back to Gemini automatically.
// Returns a clean JSON string ready for JSON.parse().
export async function callLLMJSON(
  systemPrompt: string,
  userPrompt:   string,
  maxTokens   = 2048,
): Promise<string> {
  await waitForSlot();

  const anthropic = getAnthropicClient();

  if (anthropic) {
    try {
      const message = await anthropic.messages.create({
        model:      CLAUDE_MODEL,
        max_tokens: maxTokens,
        system:
          systemPrompt +
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
        .replace(/^```\s*/i,    '')
        .replace(/\s*```$/i,    '')
        .trim();

      logger.debug({ model: CLAUDE_MODEL }, 'LLM call served by Anthropic Claude');
      return cleaned;

    } catch (err: any) {
      logger.warn(
        { err: err?.message?.slice(0, 200) },
        'Anthropic Claude failed — falling back to Gemini',
      );
      // Fall through to Gemini
    }
  } else {
    logger.debug('ANTHROPIC_API_KEY not set — routing directly to Gemini');
  }

  logger.debug('LLM call served by Gemini');
  return callGeminiJSON(systemPrompt, userPrompt, maxTokens);
}

// ─── callLLMText — plain text output ─────────────────────────────────────────
// For summaries and narratives that don't need strict JSON.
export async function callLLMText(
  systemPrompt: string,
  userPrompt:   string,
  maxTokens   = 2048,
): Promise<string> {
  await waitForSlot();

  const anthropic = getAnthropicClient();

  if (anthropic) {
    try {
      const message = await anthropic.messages.create({
        model:      CLAUDE_MODEL,
        max_tokens: maxTokens,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userPrompt }],
      });

      const block = message.content[0];
      if (block.type !== 'text' || !block.text.trim()) {
        throw new Error('Anthropic returned an empty response');
      }
      return block.text.trim();

    } catch (err: any) {
      logger.warn(
        { err: err?.message?.slice(0, 200) },
        'Anthropic Claude text call failed — falling back to Gemini',
      );
    }
  }

  return callGeminiJSON(systemPrompt, userPrompt, maxTokens);
}