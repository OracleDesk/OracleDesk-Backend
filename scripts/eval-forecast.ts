/**
 * npm run eval:forecast [-- --replay | --live] [--record] [--model <name>]
 *   [--baseline <name>] [--prompt-version <n>] [--samples <n>]
 *   [--shrinkage <n>] [--members <llm,base_rate>] [--base-rate-version <n>]
 *   [--max-calls <n>] [--case <id>]
 *
 * Exit codes: 0 non-inferior & thresholds met, 1 regression/inferiority, 2 error.
 */
import path from 'node:path';
import { ensureEvalEnv } from './eval/env';
import type { ForecasterMember } from './eval/forecast-runner';

const ROOT = path.join(__dirname, '..');

function parse(argv: string[]) {
  const flag = (n: string) => argv.includes(`--${n}`);
  const value = (n: string) => {
    const i = argv.indexOf(`--${n}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  if (flag('live') && flag('replay')) throw new Error('--live and --replay are mutually exclusive');
  if (flag('record') && !flag('live')) throw new Error('--record needs --live');

  const membersRaw = value('members') ?? 'llm,base_rate';
  const members = membersRaw.split(',').map((s) => s.trim()).filter(Boolean) as ForecasterMember[];

  return {
    mode: flag('live') ? ('live' as const) : ('replay' as const),
    record: flag('record'),
    model: value('model') ?? 'synthetic-baseline',
    baselineModel: value('baseline') ?? 'synthetic-baseline',
    promptId: 'forecast',
    promptVersion: Number(value('prompt-version') ?? 1),
    samples: Number(value('samples') ?? 1),
    shrinkage: Number(value('shrinkage') ?? 0.25),
    members,
    baseRateTableVersion: value('base-rate-version') ? Number(value('base-rate-version')) : undefined,
    maxLlmCalls: Number(value('max-calls') ?? 20),
    caseId: value('case'),
  };
}

async function main(): Promise<void> {
  const args = parse(process.argv.slice(2));
  ensureEvalEnv();
  if (args.mode === 'live') {
    const { setSecretsForTest, SECRET_NAMES } = await import('../src/config/secrets');
    setSecretsForTest(Object.fromEntries(SECRET_NAMES.map((n) => [n, process.env[n] ?? ''])) as any);
    const budget = await import('../src/lib/llm-budget');
    budget.setLlmGuardStore(new budget.MemoryGuardStore());
    if (!process.env.ANTHROPIC_API_KEY && !process.env.GEMINI_API_KEY) {
      console.error('--live needs ANTHROPIC_API_KEY or GEMINI_API_KEY');
      process.exit(2);
    }
  }

  const { runForecastEval } = await import('./eval/forecast-runner');
  const outcome = await runForecastEval({
    ...args,
    corpusDir: path.join(ROOT, 'tests/eval/forecast-corpus'),
    recordingsDir: path.join(ROOT, 'tests/eval/recordings'),
    thresholdsPath: path.join(ROOT, 'tests/eval/forecast-thresholds.json'),
    outDir: path.join(ROOT, 'eval-results'),
  });

  for (const e of outcome.errors) console.error(e);
  if (outcome.report) {
    const { candidate, baseline, comparison } = outcome.report;
    console.log(`Brier    ${candidate.brier.toFixed(4)} (baseline ${baseline.brier.toFixed(4)}, Δ95% [${comparison.deltaBrier.ci95.lower.toFixed(4)}, ${comparison.deltaBrier.ci95.upper.toFixed(4)}])`);
    console.log(`LogLoss  ${candidate.logLoss.toFixed(4)} (baseline ${baseline.logLoss.toFixed(4)}, Δ95% [${comparison.deltaLogLoss.ci95.lower.toFixed(4)}, ${comparison.deltaLogLoss.ci95.upper.toFixed(4)}])`);
    console.log(`ECE      ${candidate.ece.toFixed(4)} (baseline ${baseline.ece.toFixed(4)})`);
    for (const f of comparison.failures) console.error(`GATE FAILED: ${f}`);
    if (outcome.files) console.log(`\nreport: ${path.relative(ROOT, outcome.files.md)}`);
  }
  process.exit(outcome.exitCode);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(2);
});
