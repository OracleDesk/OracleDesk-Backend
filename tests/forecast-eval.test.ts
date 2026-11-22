import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setupTestEnv } from './helpers/env';

setupTestEnv();

test('expectedCalibrationError computes weighted calibration error across bins', async () => {
  const { expectedCalibrationError } = await import('../scripts/eval/forecast-runner');
  const ece = expectedCalibrationError([
    { p: 0.15, o: 0, w: 1 },
    { p: 0.85, o: 1, w: 1 },
  ]);
  // Bin [0.1, 0.2): meanP=0.15, obs=0 => |0.15 - 0| * 0.5
  // Bin [0.8, 0.9): meanP=0.85, obs=1 => |0.85 - 1| * 0.5
  assert.ok(Math.abs(ece - 0.15) < 1e-9);
});

test('pairedClusterBootstrap produces deterministic CIs and detects identical baseline', async () => {
  const { pairedClusterBootstrap } = await import('../scripts/eval/forecast-runner');
  const samples = [
    { p: 0.8, o: 1 as const, w: 1, clusterId: 'm1' },
    { p: 0.2, o: 0 as const, w: 1, clusterId: 'm2' },
    { p: 0.6, o: 1 as const, w: 1, clusterId: 'm3' },
  ];
  const res = pairedClusterBootstrap(samples, samples, 200, 123);
  assert.equal(res.deltaBrier.mean, 0);
  assert.equal(res.deltaBrier.ci95.lower, 0);
  assert.equal(res.deltaBrier.ci95.upper, 0);
});

test('validateCorpusCase enforces anti-leak rules and binary outcomes', async () => {
  const { validateCorpusCase } = await import('../scripts/eval/forecast-runner');
  const valid = {
    id: 'c1',
    marketId: 'm1',
    question: 'Q?',
    category: 'MACRO',
    closeTime: '2026-11-10T00:00:00Z',
    resolutionSource: null,
    questionDoc: null,
    signals: [{ id: 's1', source: 'NEWSAPI', title: 'T', publishedAt: '2026-11-01T10:00:00Z' }],
    asOf: '2026-11-01T12:00:00Z',
    marketProbability: 0.5,
    resolvedOutcome: 1 as const,
    resolvedAt: '2026-11-10T01:00:00Z',
  };
  assert.equal(validateCorpusCase(valid), null);
  assert.match(validateCorpusCase({ ...valid, asOf: '2026-11-10T01:00:00Z' })!, /anti-leak/);
  assert.match(
    validateCorpusCase({ ...valid, signals: [{ id: 's1', source: 'NEWSAPI', title: 'T', publishedAt: '2026-11-01T13:00:00Z' }] })!,
    /publishedAt/,
  );
});

test('runForecastEval replays committed corpus and passes non-inferiority gate', async () => {
  const { runForecastEval } = await import('../scripts/eval/forecast-runner');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forecast-eval-'));
  const root = path.resolve(__dirname, '..');
  const outcome = await runForecastEval({
    mode: 'replay',
    record: false,
    model: 'synthetic-baseline',
    baselineModel: 'synthetic-baseline',
    promptId: 'forecast',
    promptVersion: 1,
    samples: 1,
    shrinkage: 0.25,
    members: ['llm', 'base_rate'],
    maxLlmCalls: 10,
    corpusDir: path.join(root, 'tests/eval/forecast-corpus'),
    recordingsDir: path.join(root, 'tests/eval/recordings'),
    thresholdsPath: path.join(root, 'tests/eval/forecast-thresholds.json'),
    outDir,
  });
  assert.equal(outcome.exitCode, 0, JSON.stringify(outcome.errors));
  assert.ok(outcome.report);
  assert.equal(outcome.report.comparison.passed, true);
  assert.equal(outcome.report.candidate.n, 4);
  fs.rmSync(outDir, { recursive: true, force: true });
});
