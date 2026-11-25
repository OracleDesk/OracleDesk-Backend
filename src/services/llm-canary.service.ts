import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { writeAgentLog } from '../lib/agent-log';
import { twoProportionTest } from '../lib/stats';
import { policies, setDemotedModels, type LlmPolicies } from '../lib/llm/policy';
import { providers } from '../lib/llm/providers';
import type { LlmProvider, LlmTask, ModelSpec } from '../lib/llm/types';
import { AlertService } from './alerts.service';

export const CANARY_PROMPT_VERSION = 1;
const DEFAULT_SLICE_SIZE = 4;
const DEFAULT_MAX_BUDGET_USD = 0.5;
const DEFAULT_ALPHA = 0.05;
const DEFAULT_DEMOTION_TTL_HOURS = 24;

export interface CanaryProbeCase {
  id: string;
  prompt: string;
  validate: (text: string) => { passed: boolean; score: number };
}

export interface CanaryRunOptions {
  policiesOverride?: LlmPolicies;
  providersOverride?: Partial<Record<ModelSpec['provider'], LlmProvider>>;
  sliceSize?: number;
  maxBudgetUsd?: number;
  alpha?: number;
  autoDemote?: boolean;
  demotionTtlHours?: number;
  now?: Date;
}

export interface CanaryTaskResult {
  task: LlmTask;
  provider: string;
  model: string;
  servedModel: string | null;
  sampleCount: number;
  passCount: number;
  passRate: number;
  meanScore: number;
  pValue: number | null;
  drifted: boolean;
  driftReason: string | null;
  budgetSpentUsd: number;
}

function estimateCallUsd(inputTokens = 0, outputTokens = 0): number {
  // Conservative blended ceiling ($3/M input, $15/M output) for canary budget capping
  return (inputTokens * 3 + outputTokens * 15) / 1_000_000;
}

function parseJsonSafe(raw: string): Record<string, any> | null {
  try {
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(cleaned);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function loadCorpusSlice(limit: number): CanaryProbeCase[] {
  const corpusDir = path.resolve(process.cwd(), 'tests/eval/corpus');
  const cases: CanaryProbeCase[] = [];
  try {
    if (fs.existsSync(corpusDir)) {
      const files = fs.readdirSync(corpusDir).filter((f) => f.endsWith('.json')).sort().slice(0, limit);
      for (const file of files) {
        const raw = JSON.parse(fs.readFileSync(path.join(corpusDir, file), 'utf8'));
        const id = String(raw.id ?? file.replace(/\.json$/, ''));
        const topic = String(raw.topic ?? raw.headline ?? raw.title ?? id);
        cases.push({
          id,
          prompt: `Generate a binary prediction market JSON with fields: question (ending with ?), category, resolutionSource, expiryIso for topic: ${topic}`,
          validate: (text) => {
            const obj = parseJsonSafe(text);
            if (!obj) return { passed: false, score: 0 };
            let checks = 0;
            if (typeof obj.question === 'string' && obj.question.trim().endsWith('?')) checks++;
            if (typeof obj.resolutionSource === 'string' && obj.resolutionSource.trim().length > 2) checks++;
            if (typeof obj.expiryIso === 'string' && !Number.isNaN(Date.parse(obj.expiryIso))) checks++;
            const score = checks / 3;
            return { passed: checks === 3, score };
          },
        });
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Canary: failed to load eval corpus slice; using built-in probes');
  }

  if (cases.length > 0) return cases;

  return [
    {
      id: 'builtin-mg-1',
      prompt: 'Generate a binary prediction market JSON with fields: question (ending with ?), category, resolutionSource, expiryIso for topic: BTC spot price above $100k by year end.',
      validate: (text) => {
        const obj = parseJsonSafe(text);
        if (!obj) return { passed: false, score: 0 };
        const ok = typeof obj.question === 'string' && obj.question.includes('?') && typeof obj.resolutionSource === 'string';
        return { passed: ok, score: ok ? 1 : 0.25 };
      },
    },
  ];
}

function buildProbesForTask(task: LlmTask, sliceSize: number): { system: string; mode: 'json' | 'text'; cases: CanaryProbeCase[] } {
  if (task === 'market_generation') {
    return {
      system: 'You are a prediction market designer. Return only valid JSON.',
      mode: 'json',
      cases: loadCorpusSlice(sliceSize),
    };
  }

  if (task === 'forecasting') {
    const scenarios = [
      { id: 'fc-1', q: 'Will US CPI YoY exceed 4.0% next month given current 2.8% trend?' },
      { id: 'fc-2', q: 'Will a coin flip land heads on the next toss?' },
      { id: 'fc-3', q: 'Will Ethereum finalize its next epoch within 15 minutes under normal operation?' },
    ];
    return {
      system: 'You are a calibrated forecaster. Return JSON: {"probability": <number between 0 and 1>, "confidence": <number between 0 and 1>}.',
      mode: 'json',
      cases: scenarios.map((s) => ({
        id: s.id,
        prompt: s.q,
        validate: (text) => {
          const obj = parseJsonSafe(text);
          if (!obj) return { passed: false, score: 0 };
          const p = Number(obj.probability);
          const c = Number(obj.confidence);
          const ok = Number.isFinite(p) && p >= 0.01 && p <= 0.99 && Number.isFinite(c) && c >= 0 && c <= 1;
          return { passed: ok, score: ok ? 1 : 0 };
        },
      })),
    };
  }

  if (task === 'generic_text') {
    return {
      system: 'Respond concisely in plain text.',
      mode: 'text',
      cases: [
        {
          id: 'txt-1',
          prompt: 'Summarize the purpose of a binary prediction market in one sentence.',
          validate: (text) => {
            const ok = text.trim().length >= 15;
            return { passed: ok, score: ok ? 1 : 0 };
          },
        },
      ],
    };
  }

  // hedge_conditions, attestation, dispute_review, generic_json
  return {
    system: 'Return a valid JSON object with keys {"ok": boolean, "summary": string}.',
    mode: 'json',
    cases: [
      {
        id: `${task}-json-1`,
        prompt: `Produce a valid JSON status object for task ${task}.`,
        validate: (text) => {
          const obj = parseJsonSafe(text);
          const ok = Boolean(obj && typeof obj.ok === 'boolean' && typeof obj.summary === 'string');
          return { passed: ok, score: ok ? 1 : 0 };
        },
      },
    ],
  };
}

/**
 * Evaluates statistical drift against a stored baseline.
 */
export function evaluateDrift(
  current: { passCount: number; sampleCount: number; meanScore: number; servedModel: string | null },
  baseline: { passCount: number; sampleCount: number; passRate: number; meanScore: number; scoreStdDev: number } | null,
  alpha = DEFAULT_ALPHA,
): { pValue: number | null; drifted: boolean; driftReason: string | null } {
  if (!baseline || baseline.sampleCount === 0 || current.sampleCount === 0) {
    return { pValue: null, drifted: false, driftReason: null };
  }

  const test = twoProportionTest(
    baseline.passCount,
    baseline.sampleCount,
    current.passCount,
    current.sampleCount,
  );
  const currentRate = current.passCount / current.sampleCount;

  if (currentRate < baseline.passRate && test.pValue < alpha) {
    return {
      pValue: test.pValue,
      drifted: true,
      driftReason: `pass_rate_drop (${(baseline.passRate * 100).toFixed(1)}% -> ${(currentRate * 100).toFixed(1)}%, p=${test.pValue.toFixed(4)})`,
    };
  }

  if (baseline.scoreStdDev > 0 && current.meanScore < baseline.meanScore) {
    const zScore = (baseline.meanScore - current.meanScore) / baseline.scoreStdDev;
    if (zScore > 2.5) {
      return {
        pValue: test.pValue,
        drifted: true,
        driftReason: `mean_score_drop (${baseline.meanScore.toFixed(3)} -> ${current.meanScore.toFixed(3)}, z=${zScore.toFixed(2)})`,
      };
    }
  }

  return { pValue: test.pValue, drifted: false, driftReason: null };
}

/**
 * Loads active non-expired demotions from Postgres and updates the in-memory
 * LLM policy overlay.
 */
export async function syncActiveDemotions(now: Date = new Date()): Promise<number> {
  const rows = await prisma.llmModelDemotion.findMany({
    where: { active: true, expiresAt: { gt: now } },
    select: { task: true, provider: true, model: true },
  });
  setDemotedModels(rows);
  return rows.length;
}

/**
 * Runs one canary evaluation pass across every configured (task, model) pair
 * within an isolated budget cap.
 */
export async function runLlmCanaryPass(opts: CanaryRunOptions = {}): Promise<CanaryTaskResult[]> {
  const activePolicies = opts.policiesOverride ?? policies;
  const activeProviders = opts.providersOverride ?? providers;
  const sliceSize = opts.sliceSize ?? DEFAULT_SLICE_SIZE;
  const maxBudgetUsd = opts.maxBudgetUsd ?? DEFAULT_MAX_BUDGET_USD;
  const alpha = opts.alpha ?? DEFAULT_ALPHA;
  const autoDemote = opts.autoDemote ?? true;
  const demotionTtlHours = opts.demotionTtlHours ?? DEFAULT_DEMOTION_TTL_HOURS;
  const now = opts.now ?? new Date();

  let budgetSpentUsd = 0;
  const results: CanaryTaskResult[] = [];

  for (const [taskKey, chain] of Object.entries(activePolicies) as Array<[LlmTask, ModelSpec[]]>) {
    const probe = buildProbesForTask(taskKey, sliceSize);

    for (const spec of chain) {
      if (budgetSpentUsd >= maxBudgetUsd) {
        logger.warn({ budgetSpentUsd, maxBudgetUsd, task: taskKey, model: spec.model }, 'Canary budget cap reached; stopping pass');
        break;
      }

      const provider = activeProviders[spec.provider];
      if (!provider || !provider.available()) continue;

      let passCount = 0;
      let sampleCount = 0;
      const scores: number[] = [];
      let servedModel: string | null = null;
      let runSpentUsd = 0;

      for (const c of probe.cases) {
        if (budgetSpentUsd >= maxBudgetUsd) break;
        sampleCount++;
        try {
          const completion = await provider.complete(spec, {
            task: taskKey,
            system: probe.system,
            user: c.prompt,
            mode: probe.mode,
            maxTokens: Math.min(512, spec.maxTokens),
            ctx: { purpose: 'canary', priority: 'cron', isolated: true },
          });
          if (completion.servedModel) servedModel = completion.servedModel;
          const callUsd = estimateCallUsd(completion.usage?.inputTokens, completion.usage?.outputTokens);
          runSpentUsd += callUsd;
          budgetSpentUsd += callUsd;
          const res = c.validate(completion.text);
          if (res.passed) passCount++;
          scores.push(res.score);
        } catch (err) {
          logger.warn({ err: err instanceof Error ? err.message : err, task: taskKey, model: spec.model, caseId: c.id }, 'Canary probe call failed');
          scores.push(0);
        }
      }

      if (sampleCount === 0) continue;

      const passRate = passCount / sampleCount;
      const meanScore = scores.reduce((a, b) => a + b, 0) / scores.length;
      const variance = scores.reduce((a, b) => a + (b - meanScore) ** 2, 0) / scores.length;
      const stdDev = Math.sqrt(variance);

      const baseline = await prisma.llmCanaryBaseline.findUnique({
        where: {
          task_provider_model_promptVersion: {
            task: taskKey,
            provider: spec.provider,
            model: spec.model,
            promptVersion: CANARY_PROMPT_VERSION,
          },
        },
      });

      const drift = evaluateDrift(
        { passCount, sampleCount, meanScore, servedModel },
        baseline,
        alpha,
      );

      await prisma.llmCanaryRun.create({
        data: {
          task: taskKey,
          provider: spec.provider,
          model: spec.model,
          servedModel,
          promptVersion: CANARY_PROMPT_VERSION,
          sampleCount,
          passCount,
          passRate,
          meanScore,
          pValue: drift.pValue,
          drifted: drift.drifted,
          driftReason: drift.driftReason,
          budgetSpentUsd: runSpentUsd,
          details: { scores },
        },
      });

      if (!baseline) {
        await prisma.llmCanaryBaseline.create({
          data: {
            task: taskKey,
            provider: spec.provider,
            model: spec.model,
            promptVersion: CANARY_PROMPT_VERSION,
            sampleCount,
            passCount,
            passRate,
            meanScore,
            scoreStdDev: stdDev,
            metricsJson: { servedModel },
          },
        });
      } else if (!drift.drifted) {
        const nextSamples = baseline.sampleCount + sampleCount;
        const nextPasses = baseline.passCount + passCount;
        const nextMean = (baseline.meanScore * baseline.sampleCount + meanScore * sampleCount) / nextSamples;
        await prisma.llmCanaryBaseline.update({
          where: { id: baseline.id },
          data: {
            sampleCount: nextSamples,
            passCount: nextPasses,
            passRate: nextPasses / nextSamples,
            meanScore: nextMean,
            scoreStdDev: baseline.scoreStdDev > 0 ? (baseline.scoreStdDev + stdDev) / 2 : stdDev,
          },
        });
      } else {
        await writeAgentLog({
          agentType: 'MARKET_MAKER',
          level: 'WARN',
          action: 'LLM_MODEL_DRIFT',
          data: {
            task: taskKey,
            provider: spec.provider,
            model: spec.model,
            servedModel,
            pValue: drift.pValue,
            reason: drift.driftReason,
          },
        }).catch(() => undefined);

        await new AlertService()
          .sendOps({
            kind: 'ops',
            level: 'WARN',
            severity: 'WARN',
            subjectType: 'llm_drift',
            subjectKey: `${taskKey}:${spec.provider}:${spec.model}`,
            summary: `LLM drift detected for ${taskKey} on ${spec.provider}/${spec.model}: ${drift.driftReason}`,
            detail: { task: taskKey, provider: spec.provider, model: spec.model, servedModel, pValue: drift.pValue },
            state: 'OPEN',
            incidentId: `llm-drift:${taskKey}:${spec.provider}:${spec.model}:${now.toISOString().slice(0, 10)}`,
            episode: 1,
            notification: 'open',
            adminUrl: '/api/v1/admin/llm/canary',
          })
          .catch(() => undefined);

        if (autoDemote) {
          const expiresAt = new Date(now.getTime() + demotionTtlHours * 3600_000);
          await prisma.llmModelDemotion.updateMany({
            where: { task: taskKey, provider: spec.provider, model: spec.model, active: true },
            data: { active: false },
          });
          await prisma.llmModelDemotion.create({
            data: {
              task: taskKey,
              provider: spec.provider,
              model: spec.model,
              reason: drift.driftReason ?? 'canary_drift',
              demotedBy: 'canary',
              expiresAt,
              active: true,
            },
          });
        }
      }

      results.push({
        task: taskKey,
        provider: spec.provider,
        model: spec.model,
        servedModel,
        sampleCount,
        passCount,
        passRate,
        meanScore,
        pValue: drift.pValue,
        drifted: drift.drifted,
        driftReason: drift.driftReason,
        budgetSpentUsd: runSpentUsd,
      });
    }
  }

  await syncActiveDemotions(now).catch(() => undefined);
  return results;
}

export async function getCanaryAdminView() {
  const now = new Date();
  const [runs, baselines, demotions] = await Promise.all([
    prisma.llmCanaryRun.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
    prisma.llmCanaryBaseline.findMany({ orderBy: [{ task: 'asc' }, { provider: 'asc' }] }),
    prisma.llmModelDemotion.findMany({
      where: { active: true, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  return { runs, baselines, demotions };
}

export async function setAdminModelDemotion(input: {
  task: string;
  provider: string;
  model: string;
  active: boolean;
  reason?: string;
  ttlHours?: number;
}) {
  await prisma.llmModelDemotion.updateMany({
    where: { task: input.task, provider: input.provider, model: input.model, active: true },
    data: { active: false },
  });
  let created = null;
  if (input.active) {
    const ttlHours = input.ttlHours ?? DEFAULT_DEMOTION_TTL_HOURS;
    created = await prisma.llmModelDemotion.create({
      data: {
        task: input.task,
        provider: input.provider,
        model: input.model,
        reason: input.reason ?? 'admin_override',
        demotedBy: 'admin',
        expiresAt: new Date(Date.now() + ttlHours * 3600_000),
        active: true,
      },
    });
  }
  await syncActiveDemotions();
  return created;
}
