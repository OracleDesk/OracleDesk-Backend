/**
 * Gemini structured output (#65): `responseSchema` with a JSON MIME type, the
 * text parsed with no fence stripping. Model and temperature come from the
 * policy ModelSpec (#218), not GEMINI_MODEL.
 */
import type { Content } from '@google/generative-ai';
import { AppError } from '../../../middlewares/error.middleware';
import { sha256Hex } from '../../../utils/hash.util';
import { callGeminiStructured, isGeminiAvailable } from '../../gemini';
import type { StructuredSpec } from '../../llm-schema';
import type { ModelSpec } from '../types';
import { StructuredValidationError, check, type Run, type Served, type StructuredAdapter } from './types';

async function attempt<T>(spec: StructuredSpec<T>, model: ModelSpec, run: Run): Promise<{ value: T } & Served> {
  if (!isGeminiAvailable()) throw new AppError(503, 'LLM_UNAVAILABLE', 'GEMINI_API_KEY is not set');
  const contents: Content[] = [{ role: 'user', parts: [{ text: run.prompts.user }] }];
  let repaired = false;
  let reported = null as Served['usage'];

  for (;;) {
    run.calls.n++;
    const { text, usage, reportedUsage, attempts } = await callGeminiStructured(
      run.prompts.system,
      contents,
      spec.geminiSchema,
      run.maxTokens,
      { signal: run.signal, ctx: run.ctx, model: model.model, temperature: model.temperature },
    );

    run.calls.n += Math.max(0, attempts - 1); // 429 retries are requests too
    if (reportedUsage) {
      reported = {
        inputTokens: (reported?.inputTokens ?? 0) + reportedUsage.inputTokens,
        outputTokens: (reported?.outputTokens ?? 0) + reportedUsage.outputTokens,
      };
    }

    // No fence stripping: responseSchema output must already be plain JSON.
    let problem: string;
    try {
      const checked = check(spec, JSON.parse(text));
      if (checked.ok) {
        const modelVersion = (result.response as any).modelVersion;
        return {
          value: checked.value,
          provider: 'gemini',
          model: usage.model ?? model.model,
          ...(typeof modelVersion === 'string' && modelVersion ? { servedModel: modelVersion } : {}),
          attempts: run.calls.n,
          outputSha256: sha256Hex(text),
          usage: reported,
          params: { temperature: model.temperature, maxTokens: run.maxTokens },
        };
      }
      problem = checked.issues;
    } catch (err) {
      if (!(err instanceof SyntaxError)) throw err;
      problem = `- output is not valid JSON (${err.message.slice(0, 80)})`;
    }

    if (repaired) throw new StructuredValidationError('gemini', [problem]);
    repaired = true;
    contents.push(
      { role: 'model', parts: [{ text }] },
      { role: 'user', parts: [{ text: `Your previous output failed validation:\n${problem}\nReturn the corrected JSON only.` }] },
    );
  }
}

export const geminiStructured: StructuredAdapter = {
  provider: 'gemini',
  available: isGeminiAvailable,
  attempt,
};
