/**
 * Estimates source/publisher weights from resolved markets (#223).
 *
 *   npm run weights:estimate -- --window 180d
 *   npm run weights:estimate -- --window 180d --cutoff 2026-10-15 --save --created-by G...
 *
 * Fits on markets resolved before --cutoff (default: the last fifth of the
 * window) and scores held-out log loss on the rest. Prints, per key, the
 * current and proposed weight, the 90% interval, nEff and nMarkets, then how
 * the latest aggregation's ranking would change. --save stores the result as
 * the next DRAFT version (with regression: true when it is worse than its
 * parent on held-out log loss); approval and activation go through the admin
 * API. See docs/architecture.md ("Learned source weights").
 */
import { parseArgs } from 'node:util';
import { prisma } from '../src/lib/prisma';
import { config } from '../src/config';
import { representatives, AGGREGATE_WINDOW_HOURS } from '../src/services/ingestion.service';
import { getSignalStore } from '../src/services/signal-store.service';
import {
  COMPILED_WEIGHT_TABLE,
  DEFAULT_PRIOR_SD,
  estimateWeightSet,
  loadWeightSamples,
  parseWeights,
  saveWeightSet,
} from '../src/services/source-weights.service';

const HELP = `Usage: weights:estimate [options]
  --window <Nd|all>        resolved-market window                          default 180d
  --cutoff <iso|date>      fit before, score after                         default: last 20% of the window
  --prior-sd-source <x>    τ_s, prior sd of β_source around 1              default ${DEFAULT_PRIOR_SD.source}
  --prior-sd-publisher <x> τ_p, prior sd of β_publisher around β_source    default ${DEFAULT_PRIOR_SD.publisher}
  --min-neff <n>           keys below keep the parent weight               default WEIGHTS_MIN_NEFF (${config.WEIGHTS_MIN_NEFF})
  --save                   store the result as the next DRAFT set
  --created-by <address>   admin recorded as creator (required with --save; must differ from the approver)
  --json                   print the estimate as JSON instead of tables`;

const DAY_MS = 86_400_000;

function parseWindow(w: string): number | null {
  if (w === 'all') return null;
  const m = /^(\d+)d$/.exec(w);
  if (!m || Number(m[1]) <= 0) throw new Error(`--window must be Nd or all, got ${w}`);
  return Number(m[1]);
}

const fmt = (x: number | null | undefined, d = 3) => (x === null || x === undefined ? '—' : x.toFixed(d));

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      window: { type: 'string', default: '180d' },
      cutoff: { type: 'string' },
      'prior-sd-source': { type: 'string' },
      'prior-sd-publisher': { type: 'string' },
      'min-neff': { type: 'string' },
      save: { type: 'boolean', default: false },
      'created-by': { type: 'string' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log(HELP);
    return;
  }
  if (values.save && !values['created-by']) throw new Error('--save requires --created-by <admin address>');

  const now = new Date();
  const days = parseWindow(values.window!);
  const since = days === null ? null : new Date(now.getTime() - days * DAY_MS);
  const cutoff = values.cutoff ? new Date(values.cutoff) : new Date(now.getTime() - Math.round((days ?? 150) / 5) * DAY_MS);
  if (Number.isNaN(cutoff.getTime())) throw new Error(`--cutoff does not parse: ${values.cutoff}`);

  // The parent is the ACTIVE set (compiled table when none); a failed lookup is fatal here, not a fallback.
  const active = await prisma.sourceWeightSet.findFirst({ where: { status: 'ACTIVE' } });
  const parent = active ? { id: active.id, version: active.version, weights: parseWeights(active.weights) } : COMPILED_WEIGHT_TABLE;
  const { samples, counts } = await loadWeightSamples(prisma, since);
  const est = estimateWeightSet(samples, {
    parent,
    cutoff,
    window: values.window!,
    priorSd: {
      ...(values['prior-sd-source'] ? { source: Number(values['prior-sd-source']) } : {}),
      ...(values['prior-sd-publisher'] ? { publisher: Number(values['prior-sd-publisher']) } : {}),
    },
    ...(values['min-neff'] ? { minNEff: Number(values['min-neff']) } : {}),
    counts,
  });

  if (values.json) {
    console.log(JSON.stringify(est, null, 2));
  } else {
    const m = est.method;
    console.log(`Parent: v${parent.version}${parent.id ? ` (${parent.id})` : ' (compiled SOURCE_WEIGHTS)'}`);
    console.log(`Traces ${counts.traces}; skipped without adjustments ${counts.tracesWithoutAdjustments}; adjustments ${counts.adjustments}, unresolved ${counts.unresolvedAdjustments}`);
    console.log(`Fit: ${m.fit.samples} samples / ${m.fit.markets} markets before ${m.cutoff}; IRLS ${m.fit.iterations} iterations${m.fit.converged ? '' : ' (NOT converged)'}`);
    console.log(`Held out: ${m.heldOut.samples} samples / ${m.heldOut.markets} markets; log loss ${fmt(m.heldOut.logLossParent, 4)} → ${fmt(m.heldOut.logLossProposed, 4)} (Δ ${fmt(m.heldOutDeltaLogLoss, 4)})${m.regression ? '  REGRESSION' : ''}`);
    console.log(`inputDigest ${m.inputDigest}\n`);
    console.log(['key'.padEnd(36), 'current', 'proposed', '90% interval'.padEnd(15), 'nEff'.padStart(7), 'nMkts'.padStart(6)].join('  '));
    for (const [key, iv] of Object.entries(est.intervals).sort(([a], [b]) => (a < b ? -1 : 1))) {
      console.log([
        key.padEnd(36),
        fmt(iv.current).padStart(7),
        fmt(est.weights[key] ?? iv.current).padStart(8),
        `[${fmt(iv.lower)}, ${fmt(iv.upper)}]`.padEnd(15),
        fmt(iv.nEff, 1).padStart(7),
        String(iv.nMarkets).padStart(6),
        iv.insufficient ? ' insufficient: parent kept' : '',
      ].join('  '));
    }

    // Ranking diff on the latest aggregation window.
    const rows = await getSignalStore().recent(new Date(now.getTime() - AGGREGATE_WINDOW_HOURS * 3_600_000));
    const before = representatives(rows, now, parent);
    const after = representatives(rows, now, { id: null, version: -1, weights: est.weights });
    const rankBefore = new Map(before.map((s, i) => [s.signalId, i + 1]));
    const moved = after
      .map((s, i) => ({ s, from: rankBefore.get(s.signalId) ?? null, to: i + 1 }))
      .filter((x) => x.from !== x.to);
    console.log(`\nRanking diff on the latest aggregation (${after.length} representatives, ${moved.length} moved):`);
    for (const x of moved.slice(0, 25)) {
      console.log(`  ${String(x.from ?? '—').padStart(3)} → ${String(x.to).padStart(3)}  ${x.s.source}/${x.s.publisher ?? '-'}  ${x.s.title.slice(0, 70)}`);
    }
  }

  if (values.save) {
    const row = await saveWeightSet(est, values['created-by']!);
    console.log(`\nSaved DRAFT v${row.version} (${row.id})${est.method.regression ? ' with regression: true (cannot be approved)' : ''}`);
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
