/**
 * Offline forecasting benchmark runner (#310).
 *
 * Evaluates candidate forecaster configurations (prompt version, model,
 * samples, shrinkage, members, base-rate table version) against a committed
 * point-in-time corpus of resolved markets and trader traces.
 *
 * Replay (default) reads recorded model outputs keyed by sha256(system + user)
 * and requires no API keys, database, or network. --live calls real providers
 * within a strict call budget (--max-calls) and with --record saves new
 * recordings after secret scanning.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { config } from '../../src/config';
import { setClock } from '../../src/lib/clock';
import { callLLMStructured } from '../../src/lib/llm';
import { getPrompt } from '../../src/lib/prompts';
import { canonicalJson, sha256Hex } from '../../src/utils/hash.util';
import {
  brier,
  logLoss,
  murphy,
  reliability,
  type Murphy,
  type Sample,
} from '../../src/services/calibration.service';
import {
  buildForecastPrompt,
  createBaseRateForecaster,
  ensemble,
  ForecastSession,
  forecastSpec,
  type BaseRateTable,
} from '../../src/services/forecast.service';
import { loadRecording, promptKey, RecordingMissingError, saveRecording } from './recordings';
import type { ForecastInput, MarketCategory, ModelForecast } from '../../src/types';
import type { Interval } from '../../src/lib/stats';
import baseRateTableDefault from '../../src/services/forecast.base-rates.json';

export type ForecasterMember = 'llm' | 'base_rate';

export interface ForecastEvalCase {
  id: string;
  marketId: string;
  question: string;
  category: MarketCategory | string;
  closeTime: string;
  resolutionSource: string | null;
  questionDoc: Record<string, unknown> | null;
  signals: Array<{
    id: string;
    source: string;
    title: string;
    publishedAt: string;
  }>;
  /** Point-in-time timestamp strictly before resolvedAt. */
  asOf: string;
  marketProbability: number;
  resolvedOutcome: 0 | 1;
  resolvedAt: string;
  /** Optional recorded baseline probability when no baseline recordings are compared. */
  baselineP?: number;
}

export interface ForecastThresholds {
  maxBrier?: number;
  maxLogLoss?: number;
  maxEce?: number;
  /** Non-inferiority margin: upper 95% CI of (candidate - baseline) must be <= margin. */
  maxDeltaBrier: number;
  maxDeltaLogLoss: number;
  bootstrapIterations?: number;
}

export interface ForecastEvalOptions {
  mode: 'replay' | 'live';
  record: boolean;
  model: string;
  baselineModel: string;
  promptId: string;
  promptVersion: number;
  samples: number;
  shrinkage: number;
  members: ForecasterMember[];
  baseRateTableVersion?: number;
  maxLlmCalls: number;
  caseId?: string;
  corpusDir: string;
  recordingsDir: string;
  thresholdsPath: string;
  outDir: string;
}

export interface ClusteredSample extends Sample {
  clusterId: string;
}

export interface BootstrapSummary {
  mean: number;
  ci95: Interval;
}

export interface ForecastMetrics {
  n: number;
  clusters: number;
  brier: number;
  logLoss: number;
  ece: number;
  murphy: Murphy;
}

export interface NonInferiorityResult {
  passed: boolean;
  deltaBrier: BootstrapSummary;
  deltaLogLoss: BootstrapSummary;
  deltaEce: BootstrapSummary;
  failures: string[];
}

export interface ForecastEvalReport {
  meta: {
    mode: 'replay' | 'live';
    model: string;
    baselineModel: string;
    prompt: { id: string; version: number; contentHash: string };
    samples: number;
    shrinkage: number;
    members: ForecasterMember[];
    baseRateTableVersion: number;
    caseCount: number;
    gitSha: string;
  };
  candidate: ForecastMetrics;
  baseline: ForecastMetrics;
  comparison: NonInferiorityResult;
  cases: Array<{
    id: string;
    marketId: string;
    category: string;
    resolvedOutcome: 0 | 1;
    candidateP: number;
    baselineP: number;
    marketP: number;
  }>;
}

/** Expected Calibration Error across equal-width probability bins. */
export function expectedCalibrationError(samples: Sample[], bins = 10): number {
  const totalWeight = samples.reduce((a, s) => a + s.w, 0);
  if (totalWeight === 0) return NaN;
  const buckets = reliability(samples, bins, 'equal');
  let ece = 0;
  for (const b of buckets) {
    if (b.count === 0 || b.meanPredicted === null || b.observed === null) continue;
    ece += (b.count / totalWeight) * Math.abs(b.meanPredicted - b.observed);
  }
  return ece;
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[idx];
}

/**
 * Paired cluster-bootstrap over distinct marketId clusters.
 * Computes 95% confidence intervals for candidate minus baseline differences.
 */
export function pairedClusterBootstrap(
  candidateSamples: ClusteredSample[],
  baselineSamples: ClusteredSample[],
  iterations = 1000,
  seed = 42,
): {
  deltaBrier: BootstrapSummary;
  deltaLogLoss: BootstrapSummary;
  deltaEce: BootstrapSummary;
} {
  if (candidateSamples.length !== baselineSamples.length) {
    throw new Error('Candidate and baseline sample arrays must have equal length for paired bootstrap');
  }

  const clusters = new Map<string, { cand: Sample[]; base: Sample[] }>();
  for (let i = 0; i < candidateSamples.length; i++) {
    const c = candidateSamples[i];
    const b = baselineSamples[i];
    const cid = c.clusterId;
    if (!clusters.has(cid)) clusters.set(cid, { cand: [], base: [] });
    clusters.get(cid)!.cand.push(c);
    clusters.get(cid)!.base.push(b);
  }

  const clusterList = [...clusters.values()];
  if (clusterList.length === 0) {
    const empty: BootstrapSummary = { mean: NaN, ci95: { lower: NaN, upper: NaN } };
    return { deltaBrier: empty, deltaLogLoss: empty, deltaEce: empty };
  }

  const rng = mulberry32(seed);
  const dBrier: number[] = [];
  const dLog: number[] = [];
  const dEce: number[] = [];

  for (let iter = 0; iter < iterations; iter++) {
    const cBoot: Sample[] = [];
    const bBoot: Sample[] = [];
    for (let k = 0; k < clusterList.length; k++) {
      const picked = clusterList[Math.floor(rng() * clusterList.length)];
      cBoot.push(...picked.cand);
      bBoot.push(...picked.base);
    }
    dBrier.push(brier(cBoot) - brier(bBoot));
    dLog.push(logLoss(cBoot) - logLoss(bBoot));
    dEce.push(expectedCalibrationError(cBoot) - expectedCalibrationError(bBoot));
  }

  const summarize = (arr: number[], point: number): BootstrapSummary => {
    const sorted = [...arr].sort((a, b) => a - b);
    return {
      mean: point,
      ci95: {
        lower: percentile(sorted, 0.025),
        upper: percentile(sorted, 0.975),
      },
    };
  };

  return {
    deltaBrier: summarize(dBrier, brier(candidateSamples) - brier(baselineSamples)),
    deltaLogLoss: summarize(dLog, logLoss(candidateSamples) - logLoss(baselineSamples)),
    deltaEce: summarize(dEce, expectedCalibrationError(candidateSamples) - expectedCalibrationError(baselineSamples)),
  };
}

/** Validates anti-leak invariant: asOf strictly before resolvedAt, and no future signals. */
export function validateCorpusCase(c: ForecastEvalCase): string | null {
  if (c.resolvedOutcome !== 0 && c.resolvedOutcome !== 1) {
    return `case ${c.id}: resolvedOutcome must be 0 or 1 (voided markets must be excluded)`;
  }
  const asOfMs = Date.parse(c.asOf);
  const resolvedMs = Date.parse(c.resolvedAt);
  if (!Number.isFinite(asOfMs) || !Number.isFinite(resolvedMs)) {
    return `case ${c.id}: invalid asOf or resolvedAt timestamp`;
  }
  if (asOfMs >= resolvedMs) {
    return `case ${c.id}: anti-leak violation (asOf ${c.asOf} >= resolvedAt ${c.resolvedAt})`;
  }
  for (const s of c.signals) {
    const pubMs = Date.parse(s.publishedAt);
    if (!Number.isFinite(pubMs) || pubMs > asOfMs) {
      return `case ${c.id}: signal ${s.id} publishedAt ${s.publishedAt} > asOf ${c.asOf}`;
    }
  }
  return null;
}

export function loadForecastCorpus(corpusDir: string, caseId?: string): ForecastEvalCase[] {
  if (!fs.existsSync(corpusDir)) return [];
  const files = fs.readdirSync(corpusDir).filter((f) => f.endsWith('.json')).sort();
  const cases: ForecastEvalCase[] = [];
  for (const f of files) {
    const c = JSON.parse(fs.readFileSync(path.join(corpusDir, f), 'utf8')) as ForecastEvalCase;
    if (caseId && c.id !== caseId) continue;
    cases.push(c);
  }
  return cases;
}

function loadBaseRateTable(version?: number): BaseRateTable {
  const def = baseRateTableDefault as BaseRateTable;
  if (version === undefined || version === def.version) return def;
  throw new Error(`Base-rate table version ${version} is not available (current: ${def.version})`);
}

function parseForecastOutput(raw: string): {
  base_rate: number;
  adjustments: Array<{ signal_id: string; delta: number; why: string }>;
  p: number;
  p_low_50: number;
  p_high_50: number;
  rationale: string;
} {
  const parsed = JSON.parse(raw);
  if (typeof parsed.p !== 'number' || typeof parsed.p_low_50 !== 'number' || typeof parsed.p_high_50 !== 'number') {
    throw new Error('Invalid forecast recording output: missing numeric p, p_low_50, or p_high_50');
  }
  return parsed;
}

async function evaluateConfiguration(
  cases: ForecastEvalCase[],
  opts: {
    mode: 'replay' | 'live';
    record: boolean;
    model: string;
    promptId: string;
    promptVersion: number;
    samples: number;
    shrinkage: number;
    members: ForecasterMember[];
    baseRateTableVersion?: number;
    maxLlmCalls: number;
    recordingsDir: string;
  },
): Promise<{
  predictions: Map<string, number>;
  errors: string[];
}> {
  const promptDef = getPrompt(opts.promptId, opts.promptVersion);
  const baseRateTable = loadBaseRateTable(opts.baseRateTableVersion);
  const brForecaster = createBaseRateForecaster(baseRateTable);
  const session = new ForecastSession(cases.length, opts.maxLlmCalls);

  const predictions = new Map<string, number>();
  const errors: string[] = [];

  for (const c of cases) {
    const input: ForecastInput = {
      marketId: c.marketId,
      question: c.question,
      category: c.category as MarketCategory,
      closeTime: new Date(c.closeTime),
      resolutionSource: c.resolutionSource,
      questionDoc: c.questionDoc,
      signals: c.signals,
      now: new Date(c.asOf),
    };

    const restoreClock = setClock(() => new Date(c.asOf));
    try {
      const memberForecasts: ModelForecast[] = [];

      if (opts.members.includes('llm')) {
        const fixedNonce = sha256Hex(c.id).slice(0, 12);
        const { system, user } = buildForecastPrompt(input, promptDef, fixedNonce);
        const key = promptKey(system, user);

        if (opts.mode === 'replay') {
          try {
            let rec;
            try {
              rec = loadRecording(opts.recordingsDir, opts.model, c.id, 'forecast', key);
            } catch (err) {
              if (
                err instanceof RecordingMissingError &&
                opts.model === 'synthetic-baseline' &&
                promptDef.id === 'forecast' &&
                promptDef.version === 1
              ) {
                rec = loadRecording(opts.recordingsDir, opts.model, c.id, 'forecast', 'synthetic-baseline-v1');
              } else {
                throw err;
              }
            }
            const val = parseForecastOutput(rec.output);
            const sigma = Math.max(0.03, Math.max(0, val.p_high_50 - val.p_low_50) / 1.3489795);
            memberForecasts.push({
              model: `llm:${rec.provider}:${rec.model}`,
              p: val.p,
              sigma,
              rationale: val.rationale,
              inputsDigest: key,
              detail: { recorded: true },
            });
          } catch (err) {
            if (err instanceof RecordingMissingError) {
              errors.push(err.message);
              continue;
            }
            errors.push(`${c.id}: ${(err as Error).message}`);
            continue;
          }
        } else {
          // Live mode with budget cap
          const samplePs: number[] = [];
          const sampleSigmas: number[] = [];
          let firstOut: ReturnType<typeof parseForecastOutput> | null = null;
          let usedModel = opts.model;
          let usedProvider = 'live';

          for (let s = 0; s < opts.samples; s++) {
            if (!session.takeLlmCall()) {
              errors.push(`${c.id}: max LLM calls (${opts.maxLlmCalls}) reached before completing samples`);
              break;
            }
            const res = await callLLMStructured(forecastSpec, { system, user }, {
              maxTokens: 1500,
              ctx: { purpose: 'forecast', priority: 'cron' },
              task: 'forecasting',
              prompt: { id: promptDef.id, version: promptDef.version, hash: promptDef.contentHash },
            });
            firstOut = firstOut ?? res.value;
            usedModel = res.model;
            usedProvider = res.provider;
            samplePs.push(res.value.p);
            sampleSigmas.push(Math.max(0, res.value.p_high_50 - res.value.p_low_50) / 1.3489795);
            if (opts.record && s === 0) {
              saveRecording(opts.recordingsDir, opts.model, {
                caseId: c.id,
                kind: 'forecast',
                promptKey: key,
                provider: res.provider,
                model: res.model,
                output: JSON.stringify(res.value),
              });
            }
          }

          if (samplePs.length === 0 || !firstOut) continue;
          const sortedPs = [...samplePs].sort((a, b) => a - b);
          const p = sortedPs[Math.floor(sortedPs.length / 2)];
          const medianSigma = [...sampleSigmas].sort((a, b) => a - b)[Math.floor(sampleSigmas.length / 2)];
          const sigma = Math.max(0.03, medianSigma);
          memberForecasts.push({
            model: `llm:${usedProvider}:${usedModel}`,
            p,
            sigma,
            rationale: firstOut.rationale,
            inputsDigest: key,
            detail: { samples: samplePs.length },
          });
        }
      }

      if (opts.members.includes('base_rate')) {
        const br = await brForecaster.forecast(input);
        if (br) memberForecasts.push(br);
      }

      if (memberForecasts.length === 0) {
        errors.push(`${c.id}: no forecaster member produced a forecast`);
        continue;
      }

      const digest = sha256Hex(canonicalJson({ caseId: c.id, asOf: c.asOf, promptVersion: promptDef.version }));
      const combined = ensemble(memberForecasts, opts.shrinkage, digest);
      predictions.set(c.id, combined.p);
    } finally {
      restoreClock();
    }
  }

  return { predictions, errors };
}

function computeMetrics(samples: ClusteredSample[]): ForecastMetrics {
  const clusters = new Set(samples.map((s) => s.clusterId)).size;
  return {
    n: samples.length,
    clusters,
    brier: brier(samples),
    logLoss: logLoss(samples),
    ece: expectedCalibrationError(samples),
    murphy: murphy(samples),
  };
}

function gitSha(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

export async function runForecastEval(opts: ForecastEvalOptions): Promise<{
  exitCode: number;
  report: ForecastEvalReport | null;
  errors: string[];
  files: { json: string; md: string } | null;
}> {
  const cases = loadForecastCorpus(opts.corpusDir, opts.caseId);
  if (cases.length === 0) {
    return { exitCode: 2, report: null, errors: [`no forecast corpus cases found in ${opts.corpusDir}`], files: null };
  }

  const validationErrors: string[] = [];
  for (const c of cases) {
    const err = validateCorpusCase(c);
    if (err) validationErrors.push(err);
  }
  if (validationErrors.length > 0) {
    return { exitCode: 2, report: null, errors: validationErrors, files: null };
  }

  const thresholds: ForecastThresholds = fs.existsSync(opts.thresholdsPath)
    ? JSON.parse(fs.readFileSync(opts.thresholdsPath, 'utf8'))
    : { maxDeltaBrier: 0.02, maxDeltaLogLoss: 0.05, bootstrapIterations: 1000 };

  const candRun = await evaluateConfiguration(cases, opts);
  if (candRun.errors.length > 0) {
    return { exitCode: 2, report: null, errors: candRun.errors, files: null };
  }

  const baseRun = await evaluateConfiguration(cases, {
    mode: 'replay',
    record: false,
    model: opts.baselineModel,
    promptId: 'forecast',
    promptVersion: 1,
    samples: 1,
    shrinkage: config.FORECAST_SHRINK,
    members: ['llm', 'base_rate'],
    maxLlmCalls: cases.length,
    recordingsDir: opts.recordingsDir,
  });
  if (baseRun.errors.length > 0) {
    return { exitCode: 2, report: null, errors: baseRun.errors, files: null };
  }

  const marketWeights = new Map<string, number>();
  for (const c of cases) {
    marketWeights.set(c.marketId, (marketWeights.get(c.marketId) ?? 0) + 1);
  }

  const candSamples: ClusteredSample[] = [];
  const baseSamples: ClusteredSample[] = [];
  const caseRows: ForecastEvalReport['cases'] = [];

  for (const c of cases) {
    const w = 1 / (marketWeights.get(c.marketId) ?? 1);
    const cp = candRun.predictions.get(c.id)!;
    const bp = baseRun.predictions.get(c.id)!;
    candSamples.push({ p: cp, o: c.resolvedOutcome, w, pm: c.marketProbability, clusterId: c.marketId });
    baseSamples.push({ p: bp, o: c.resolvedOutcome, w, pm: c.marketProbability, clusterId: c.marketId });
    caseRows.push({
      id: c.id,
      marketId: c.marketId,
      category: String(c.category),
      resolvedOutcome: c.resolvedOutcome,
      candidateP: cp,
      baselineP: bp,
      marketP: c.marketProbability,
    });
  }

  const candMetrics = computeMetrics(candSamples);
  const baseMetrics = computeMetrics(baseSamples);
  const boot = pairedClusterBootstrap(candSamples, baseSamples, thresholds.bootstrapIterations ?? 1000);

  const failures: string[] = [];
  if (boot.deltaBrier.ci95.upper > thresholds.maxDeltaBrier) {
    failures.push(`Brier non-inferiority failed: upper 95% CI delta ${boot.deltaBrier.ci95.upper.toFixed(4)} > margin ${thresholds.maxDeltaBrier}`);
  }
  if (boot.deltaLogLoss.ci95.upper > thresholds.maxDeltaLogLoss) {
    failures.push(`LogLoss non-inferiority failed: upper 95% CI delta ${boot.deltaLogLoss.ci95.upper.toFixed(4)} > margin ${thresholds.maxDeltaLogLoss}`);
  }
  if (thresholds.maxBrier !== undefined && candMetrics.brier > thresholds.maxBrier) {
    failures.push(`Brier ${candMetrics.brier.toFixed(4)} > maxBrier ${thresholds.maxBrier}`);
  }
  if (thresholds.maxLogLoss !== undefined && candMetrics.logLoss > thresholds.maxLogLoss) {
    failures.push(`LogLoss ${candMetrics.logLoss.toFixed(4)} > maxLogLoss ${thresholds.maxLogLoss}`);
  }
  if (thresholds.maxEce !== undefined && candMetrics.ece > thresholds.maxEce) {
    failures.push(`ECE ${candMetrics.ece.toFixed(4)} > maxEce ${thresholds.maxEce}`);
  }

  const promptDef = getPrompt(opts.promptId, opts.promptVersion);
  const baseRateTable = loadBaseRateTable(opts.baseRateTableVersion);

  const report: ForecastEvalReport = {
    meta: {
      mode: opts.mode,
      model: opts.model,
      baselineModel: opts.baselineModel,
      prompt: { id: promptDef.id, version: promptDef.version, contentHash: promptDef.contentHash },
      samples: opts.samples,
      shrinkage: opts.shrinkage,
      members: opts.members,
      baseRateTableVersion: baseRateTable.version,
      caseCount: cases.length,
      gitSha: gitSha(),
    },
    candidate: candMetrics,
    baseline: baseMetrics,
    comparison: {
      passed: failures.length === 0,
      ...boot,
      failures,
    },
    cases: caseRows,
  };

  fs.mkdirSync(opts.outDir, { recursive: true });
  const base = path.join(opts.outDir, `forecast-${opts.mode}-${opts.model}`);
  fs.writeFileSync(`${base}.json`, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(`${base}.md`, toMarkdown(report));

  return {
    exitCode: failures.length > 0 ? 1 : 0,
    report,
    errors: [],
    files: { json: `${base}.json`, md: `${base}.md` },
  };
}

function toMarkdown(report: ForecastEvalReport): string {
  const c = report.candidate;
  const b = report.baseline;
  const cmp = report.comparison;
  const lines = [
    `# Forecaster Evaluation (${report.meta.mode}: ${report.meta.model} vs ${report.meta.baselineModel})`,
    '',
    `- Prompt: \`${report.meta.prompt.id}@v${report.meta.prompt.version}\` (\`${report.meta.prompt.contentHash.slice(0, 12)}\`)`,
    `- Members: ${report.meta.members.join(', ')} | Samples: ${report.meta.samples} | Shrinkage: ${report.meta.shrinkage}`,
    `- Cases: ${c.n} across ${c.clusters} markets | Git: \`${report.meta.gitSha}\``,
    '',
    '| Metric | Candidate | Baseline | Δ (95% Cluster-Bootstrap CI) |',
    '| --- | ---: | ---: | ---: |',
    `| Brier | ${c.brier.toFixed(4)} | ${b.brier.toFixed(4)} | ${cmp.deltaBrier.mean.toFixed(4)} [${cmp.deltaBrier.ci95.lower.toFixed(4)}, ${cmp.deltaBrier.ci95.upper.toFixed(4)}] |`,
    `| Log Loss | ${c.logLoss.toFixed(4)} | ${b.logLoss.toFixed(4)} | ${cmp.deltaLogLoss.mean.toFixed(4)} [${cmp.deltaLogLoss.ci95.lower.toFixed(4)}, ${cmp.deltaLogLoss.ci95.upper.toFixed(4)}] |`,
    `| ECE | ${c.ece.toFixed(4)} | ${b.ece.toFixed(4)} | ${cmp.deltaEce.mean.toFixed(4)} [${cmp.deltaEce.ci95.lower.toFixed(4)}, ${cmp.deltaEce.ci95.upper.toFixed(4)}] |`,
    '',
    `Murphy decomposition (candidate): reliability=${c.murphy.reliability.toFixed(4)}, resolution=${c.murphy.resolution.toFixed(4)}, uncertainty=${c.murphy.uncertainty.toFixed(4)}`,
    '',
    cmp.passed ? '**Gate: PASSED**' : `**Gate: FAILED**\n${cmp.failures.map((f) => `- ${f}`).join('\n')}`,
  ];
  return `${lines.join('\n')}\n`;
}
