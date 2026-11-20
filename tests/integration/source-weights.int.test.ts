/**
 * Learned source weights against a real Postgres (#223): the one-ACTIVE
 * partial unique index under concurrent activation, approval rules, audited
 * rollback, and the sample extraction SQL over pinned trace payloads.
 */
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { integrationEnv, skipReason } from './setup';

let db: Awaited<ReturnType<typeof integrationEnv>>;
let prisma: import('@prisma/client').PrismaClient;
let truncateAll: typeof import('../helpers/db').truncateAll;
let makeMarket: typeof import('../helpers/factories').makeMarket;
let svc: typeof import('../../src/services/source-weights.service');

before(async () => {
  db = await integrationEnv('source_weights');
  if (!db) return;
  prisma = (await import('../../src/lib/prisma')).prisma;
  truncateAll = (await import('../helpers/db')).truncateAll;
  makeMarket = (await import('../helpers/factories')).makeMarket;
  // response.util first: see the import-cycle note in tests/source-weights.test.ts.
  await import('../../src/utils/response.util');
  svc = await import('../../src/services/source-weights.service');
});
beforeEach(async () => {
  if (!db) return;
  await truncateAll(prisma);
  svc.resetWeightTableCache();
});
after(async () => { if (db) { await prisma.$disconnect(); await db.drop(); } });

const CREATOR = 'GCREATORXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
const APPROVER = 'GAPPROVERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

async function weightSet(version: number, status: string, over: Record<string, unknown> = {}) {
  return prisma.sourceWeightSet.create({
    data: {
      version,
      status,
      weights: { 'source:NEWSAPI': 0.5 + version / 100 },
      intervals: {},
      method: { regression: false },
      createdBy: CREATOR,
      ...over,
    },
  });
}

test('concurrent activations leave exactly one ACTIVE set, and the index rejects a second', { skip: skipReason() }, async () => {
  const a = await weightSet(1, 'APPROVED', { approvedBy: APPROVER });
  const b = await weightSet(2, 'APPROVED', { approvedBy: APPROVER });
  const results = await Promise.allSettled([svc.activateWeightSet(a.id, APPROVER), svc.activateWeightSet(b.id, APPROVER)]);
  assert.ok(results.some((r) => r.status === 'fulfilled'));
  const active = await prisma.sourceWeightSet.findMany({ where: { status: 'ACTIVE' } });
  assert.equal(active.length, 1);
  await assert.rejects(
    prisma.$executeRaw`UPDATE source_weight_sets SET status = 'ACTIVE' WHERE status <> 'ACTIVE'`,
    /source_weight_sets_active_key|unique/i,
  );
  const audits = await prisma.adminAuditLog.findMany({ where: { action: 'SOURCE_WEIGHTS_ACTIVATED' } });
  assert.equal(audits.length, results.filter((r) => r.status === 'fulfilled').length);
  // The runtime serves the active set.
  const table = await svc.getActiveWeightTable();
  assert.equal(table.id, active[0].id);
});

test('self-approval returns 403; another admin approves, audited; regressions are refused', { skip: skipReason() }, async () => {
  const draft = await weightSet(1, 'DRAFT');
  await assert.rejects(svc.approveWeightSet(draft.id, CREATOR), (err: any) => err.statusCode === 403 && err.code === 'SELF_APPROVAL');
  assert.equal((await prisma.sourceWeightSet.findUniqueOrThrow({ where: { id: draft.id } })).status, 'DRAFT');

  const approved = await svc.approveWeightSet(draft.id, APPROVER);
  assert.equal(approved.status, 'APPROVED');
  assert.equal(approved.approvedBy, APPROVER);
  const audit = await prisma.adminAuditLog.findFirstOrThrow({ where: { action: 'SOURCE_WEIGHTS_APPROVED' } });
  assert.equal(audit.actor, APPROVER);
  assert.equal(audit.target, draft.id);

  const regression = await weightSet(2, 'DRAFT', { method: { regression: true } });
  await assert.rejects(svc.approveWeightSet(regression.id, APPROVER), (err: any) => err.statusCode === 409 && err.code === 'WEIGHT_SET_REGRESSION');
  await assert.rejects(svc.activateWeightSet(regression.id, APPROVER), (err: any) => err.code === 'WEIGHT_SET_NOT_APPROVED');
});

test('rollback reactivates the previous set atomically, then falls back to the compiled table', { skip: skipReason() }, async () => {
  const a = await weightSet(1, 'APPROVED', { approvedBy: APPROVER });
  const b = await weightSet(2, 'APPROVED', { approvedBy: APPROVER });
  await svc.activateWeightSet(a.id, APPROVER, new Date('2026-11-01T00:00:00Z'));
  await svc.activateWeightSet(b.id, APPROVER, new Date('2026-11-02T00:00:00Z'));

  const first = await svc.rollbackWeightSet(APPROVER);
  assert.deepEqual(first, { retired: { id: b.id, version: 2 }, active: { id: a.id, version: 1 } });
  const statuses = Object.fromEntries((await prisma.sourceWeightSet.findMany()).map((s) => [s.version, s.status]));
  assert.deepEqual(statuses, { 1: 'ACTIVE', 2: 'RETIRED' });

  const second = await svc.rollbackWeightSet(APPROVER);
  assert.deepEqual(second.active, { id: null, version: 0 });
  assert.equal(await prisma.sourceWeightSet.count({ where: { status: 'ACTIVE' } }), 0);
  assert.equal((await svc.getActiveWeightTable()).version, 0);
  await assert.rejects(svc.rollbackWeightSet(APPROVER), (err: any) => err.code === 'NO_ACTIVE_WEIGHT_SET');
  assert.equal(await prisma.adminAuditLog.count({ where: { action: 'SOURCE_WEIGHTS_ROLLED_BACK' } }), 2);
});

test('sample extraction joins pinned adjustments to signals and records the trace version', { skip: skipReason() }, async () => {
  const m = await makeMarket(prisma, { onChainMarketId: 77n });
  await prisma.market.update({
    where: { id: m.id },
    data: { status: 'RESOLVED', resolvedOutcome: true, resolvedAt: new Date('2026-10-10T00:00:00Z'), category: 'FED' as never },
  });
  const sig = await prisma.signal.create({
    data: { source: 'NEWSAPI', dedupKey: 'k1', publisher: 'Reuters', title: 'Fed holds', publishedAt: new Date('2026-10-01T00:00:00Z'), clusterId: 'c1' },
  });
  const trace = await prisma.reasoningTrace.create({
    data: {
      marketId: m.id, agentType: 'TRADER', decisionType: 'OPEN_POSITION', sourcesUsed: [],
      probabilityEstimate: 0.6, marketProbability: 0.5, edge: 0.1, confidenceInterval: { lower: 0.4, upper: 0.8 },
      sourceWeightSetVersion: 3, createdAt: new Date('2026-10-02T00:00:00Z'),
    },
  });
  await prisma.tracePublication.create({
    data: {
      traceId: trace.id,
      action: 'buy_yes',
      payload: {
        forecast: {
          members: [
            { model: 'llm:anthropic:claude', p: 0.6, detail: { baseRate: 0.45, adjustments: [{ signal_id: 's1', signalId: sig.id, delta: 0.1 }, { signal_id: 's2', signalId: 'gone', delta: 0.05 }] } },
          ],
        },
        sourceWeightSet: { id: null, version: 3 },
      },
    },
  });
  const { samples, counts } = await svc.loadWeightSamples(prisma, null);
  assert.deepEqual(counts, { traces: 1, tracesWithoutAdjustments: 0, adjustments: 2, unresolvedAdjustments: 1 });
  assert.equal(samples.length, 1);
  assert.equal(samples[0].weightSetVersion, 3);
  assert.equal(samples[0].category, 'FED');
  assert.deepEqual(samples[0].adjustments, [{ signalId: sig.id, delta: 0.1, source: 'NEWSAPI', publisher: 'Reuters', clusterId: 'c1' }]);
});
