import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Keypair } from '@stellar/stellar-sdk';
import { setupTestEnv } from './helpers/env';

setupTestEnv();
const ADMIN = Keypair.random().publicKey();
process.env.ADMIN_ADDRESSES = ADMIN; // read once when config loads

// Operational alerts (#226): in-memory Prisma (as tests/dispute-monitor.test.ts
// does), recording sinks, an injected clock and a fake advisory lock.

const POLICY = { openAfter: 2, resolveAfter: 3, escalateEveryMs: 30 * 60_000, minReopenMs: 10 * 60_000 };
const T0 = new Date('2026-11-20T00:00:00Z');
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

class RecordingSink {
  sent: any[] = [];
  constructor(public name = 'rec') {}
  async send(alert: any) { this.sent.push(alert); }
}

type Row = Record<string, any>;

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === 'subjectType_subjectKey') return row.subjectType === v.subjectType && row.subjectKey === v.subjectKey;
    if (k === 'OR') return (v as Row[]).some((w) => matches(row, w));
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('in' in v) return v.in.includes(row[k]);
      if ('lt' in v) return row[k] !== null && row[k] !== undefined && row[k] < v.lt;
      if ('not' in v) return row[k] !== v.not;
      return true;
    }
    return row[k] === v;
  });
}

async function memoryDb() {
  const { prisma } = await import('../src/lib/prisma');
  const p: any = prisma;
  const tables = { alertIncident: [] as Row[], alertDelivery: [] as Row[], cronRunStatus: [] as Row[], chainTransaction: [] as Row[], adminAuditLog: [] as Row[] };
  const saved: Array<[any, string, any]> = [];
  const replace = (obj: any, key: string, value: any) => { saved.push([obj, key, obj[key]]); obj[key] = value; };
  let seq = 0;
  const id = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

  const inc = tables.alertIncident;
  // Copies, as Prisma returns: callers never hold a live row.
  replace(p.alertIncident, 'findUnique', async ({ where }: any) => {
    const row = inc.find((r) => matches(r, where));
    return row ? { ...row } : null;
  });
  replace(p.alertIncident, 'findMany', async ({ where, skip, take }: any = {}) =>
    inc.filter((r) => matches(r, where)).slice(skip ?? 0, (skip ?? 0) + (take ?? 1e9)).map((r) => ({ ...r })));
  replace(p.alertIncident, 'count', async ({ where }: any = {}) => inc.filter((r) => matches(r, where)).length);
  replace(p.alertIncident, 'create', async ({ data }: any) => {
    const row = {
      id: id(), state: 'PENDING', episode: 0, detail: null, badStreak: 0, goodStreak: 0, openedAt: null, resolvedAt: null,
      ackedAt: null, ackedBy: null, silencedUntil: null, lastNotifiedAt: null, escalations: 0, createdAt: new Date(), updatedAt: new Date(), ...data,
    };
    inc.push(row);
    return { ...row };
  });
  replace(p.alertIncident, 'update', async ({ where, data }: any) => {
    const row = inc.find((r) => r.id === where.id);
    if (!row) throw Object.assign(new Error('not found'), { code: 'P2025' });
    return { ...Object.assign(row, data) };
  });

  const del = tables.alertDelivery;
  replace(p.alertDelivery, 'findUnique', async ({ where }: any) => del.find((d) => d.dedupeKey === where.dedupeKey) ?? null);
  replace(p.alertDelivery, 'findMany', async ({ where }: any) => del.filter((d) => matches(d, where)));
  replace(p.alertDelivery, 'upsert', async ({ where, create, update }: any) => {
    const existing = del.find((d) => d.dedupeKey === where.dedupeKey);
    if (existing) return Object.assign(existing, update);
    del.push({ ...create });
    return create;
  });

  const cron = tables.cronRunStatus;
  replace(p.cronRunStatus, 'findMany', async () => [...cron].sort((a, b) => (a.job < b.job ? -1 : 1)));
  replace(p.cronRunStatus, 'upsert', async ({ where, create, update }: any) => {
    const row = cron.find((r) => r.job === where.job);
    if (!row) { cron.push({ lastSuccessAt: null, lastFailureAt: null, lastError: null, failureStreak: 0, ...create }); return; }
    for (const [k, v] of Object.entries(update)) row[k] = v && typeof v === 'object' && 'increment' in (v as any) ? row[k] + (v as any).increment : v;
  });

  replace(p.chainTransaction, 'findMany', async ({ where }: any) => tables.chainTransaction.filter((r) => matches(r, where)));
  replace(p.adminAuditLog, 'create', async ({ data }: any) => { tables.adminAuditLog.push(data); return data; });

  return {
    prisma: p,
    tables,
    restore() { for (const [obj, key, value] of saved.reverse()) obj[key] = value; },
  };
}

/** A fake ops-alerts advisory lock: one holder at a time, never blocks. */
function fakeLock(db: any) {
  const state = { held: false, released: [] as number[], calls: 0 };
  const lock = async (fn: (tx: any) => Promise<any>) => {
    state.calls++;
    if (state.held) return { acquired: false as const };
    state.held = true;
    try {
      return { acquired: true as const, value: await fn(db) };
    } finally {
      state.held = false;
      state.released.push(Date.now());
    }
  };
  return { lock, state };
}

/** A scripted evaluator: each tick returns whatever `next` holds (or throws). */
function scripted(subjectType: string) {
  const ev = {
    subjectType,
    next: [] as any[] | Error,
    async evaluate() {
      if (ev.next instanceof Error) throw ev.next;
      return ev.next;
    },
  };
  return ev;
}
const badObs = (key = 'TRADER:failure_breaker', severity = 'CRITICAL') => ({ subjectKey: key, bad: true, severity, summary: `${key} paused` });

async function harness() {
  const db = await memoryDb();
  const { AlertService } = await import('../src/services/alerts.service');
  const engine = await import('../src/services/ops-alerts/engine');
  const sink = new RecordingSink();
  const alerts = new AlertService({ sinks: [sink], sleep: async () => undefined });
  const { lock, state } = fakeLock(db.prisma);
  const ev = scripted('agent_pause');
  const tick = (minutes: number, evaluators: any[] = [ev]) =>
    engine.runAlertEvaluation({ evaluators, alerts, now: at(minutes), policy: POLICY, lock: lock as any });
  const kinds = () => sink.sent.map((a) => `${a.notification}:${a.severity}`);
  const incident = (key = 'TRADER:failure_breaker') => db.tables.alertIncident.find((r) => r.subjectKey === key)!;
  return { db, sink, alerts, engine, ev, tick, kinds, incident, lockState: state, lock };
}

test('a failure_breaker pause opens a CRITICAL incident after ALERT_OPEN_AFTER ticks', async () => {
  const h = await harness();
  const controls = await import('../src/services/agent-controls.service');
  const { agentPauses } = await import('../src/services/ops-alerts/conditions');
  const orig = controls.controlsOverview;
  (controls as any).controlsOverview = async () => ({
    scopes: [
      { scope: 'ALL', paused: false, own: { paused: false, reason: null, source: null, pausedUntil: null, pausedBy: null, version: 0 } },
      { scope: 'TRADER', paused: true, own: { paused: true, reason: '5 failures', source: 'failure_breaker', pausedUntil: at(60).toISOString(), pausedBy: 'breaker', version: 1 } },
    ],
    events: [],
  });
  try {
    await h.tick(0, [agentPauses]);
    assert.equal(h.incident().state, 'PENDING', 'one bad tick is not enough');
    assert.equal(h.sink.sent.length, 0);
    await h.tick(1, [agentPauses]);
    const opened = h.incident();
    assert.equal(opened.state, 'OPEN');
    assert.equal(opened.severity, 'CRITICAL');
    assert.equal(opened.episode, 1);
    assert.deepEqual(h.kinds(), ['open:CRITICAL']);
    const [alert] = h.sink.sent;
    assert.equal(alert.kind, 'ops');
    assert.equal(alert.subjectType, 'agent_pause');
    assert.equal(alert.subjectKey, 'TRADER:failure_breaker');
    assert.match(alert.adminUrl, new RegExp(`/api/v1/admin/alerts\\?id=${opened.id}$`));
    assert.deepEqual(h.db.tables.alertDelivery.map((d) => d.dedupeKey), [`inc:${opened.id}:1:open:CRITICAL:rec`]);
    assert.equal(h.db.tables.alertDelivery[0].kind, 'open');
    assert.equal(h.db.tables.alertDelivery[0].reviewId, undefined);
  } finally {
    (controls as any).controlsOverview = orig;
    h.db.restore();
  }
});

test('an operator pause is INFO and not alerted by default', async () => {
  const h = await harness();
  const controls = await import('../src/services/agent-controls.service');
  const { agentPauses } = await import('../src/services/ops-alerts/conditions');
  const orig = controls.controlsOverview;
  (controls as any).controlsOverview = async () => ({
    scopes: [{ scope: 'ALL', paused: true, own: { paused: true, reason: 'maintenance', source: 'operator', pausedUntil: null, pausedBy: 'ops', version: 1 } }],
    events: [],
  });
  try {
    assert.deepEqual(await agentPauses.evaluate(at(0)), []);
  } finally {
    (controls as any).controlsOverview = orig;
    h.db.restore();
  }
});

test('a resume resolves only after ALERT_RESOLVE_AFTER good ticks, with one resolve notification', async () => {
  const h = await harness();
  try {
    h.ev.next = [badObs()];
    await h.tick(0);
    await h.tick(1);
    h.ev.next = []; // resumed: the subject is absent
    await h.tick(2);
    await h.tick(3);
    assert.equal(h.incident().state, 'OPEN', 'two good ticks absorb a re-pause');
    await h.tick(4);
    assert.equal(h.incident().state, 'RESOLVED');
    await h.tick(5);
    assert.deepEqual(h.kinds(), ['open:CRITICAL', 'resolve:CRITICAL']);
    assert.equal(h.sink.sent[1].state, 'RESOLVED');
  } finally {
    h.db.restore();
  }
});

test('flapping bad/good/bad within the hysteresis sends a single open', async () => {
  const h = await harness();
  try {
    const pattern = [true, true, false, true, false, false, true, false, true, true];
    for (const [i, isBad] of pattern.entries()) {
      h.ev.next = isBad ? [badObs()] : [];
      await h.tick(i * 15); // acknowledged at the open, so escalation never fires
      if (i === 1) {
        const { acknowledgeIncident } = await import('../src/services/ops-alerts/incidents');
        await acknowledgeIncident(h.incident().id, 'ops', at(i * 15));
      }
    }
    assert.deepEqual(h.kinds(), ['open:CRITICAL']);
    assert.equal(h.incident().episode, 1);
  } finally {
    h.db.restore();
  }
});

test('an evaluator error leaves its incidents open', async () => {
  const h = await harness();
  try {
    h.ev.next = [badObs()];
    await h.tick(0);
    await h.tick(1);
    h.ev.next = new Error('db timeout');
    for (let i = 2; i < 10; i++) {
      const r = await h.tick(i);
      assert.deepEqual(r.failedEvaluators, ['agent_pause']);
    }
    assert.equal(h.incident().state, 'OPEN');
    assert.equal(h.incident().goodStreak, 0, 'a failed evaluation is not a good one');
    assert.deepEqual(h.kinds(), ['open:CRITICAL']);
  } finally {
    h.db.restore();
  }
});

test('an unacknowledged CRITICAL incident escalates once per interval; ack stops it', async () => {
  const h = await harness();
  const { acknowledgeIncident } = await import('../src/services/ops-alerts/incidents');
  try {
    h.ev.next = [badObs()];
    await h.tick(0);
    await h.tick(1); // open at minute 1
    await h.tick(20);
    assert.deepEqual(h.kinds(), ['open:CRITICAL'], 'not yet one interval');
    await h.tick(31);
    await h.tick(32);
    assert.deepEqual(h.kinds(), ['open:CRITICAL', 'escalate:CRITICAL'], 'once per interval');
    await h.tick(61);
    assert.deepEqual(h.kinds(), ['open:CRITICAL', 'escalate:CRITICAL', 'escalate:CRITICAL']);
    const id = h.incident().id;
    assert.deepEqual(
      h.db.tables.alertDelivery.map((d) => d.dedupeKey),
      [`inc:${id}:1:open:CRITICAL:rec`, `inc:${id}:1:escalate-1:CRITICAL:rec`, `inc:${id}:1:escalate-2:CRITICAL:rec`],
      'each escalation step has its own key',
    );
    await acknowledgeIncident(id, ADMIN, at(62));
    await h.tick(95);
    await h.tick(130);
    assert.equal(h.sink.sent.length, 3, 'no escalation after ack');
    assert.equal(h.incident().ackedBy, ADMIN);
  } finally {
    h.db.restore();
  }
});

test('WARN incidents do not escalate', async () => {
  const h = await harness();
  try {
    h.ev.next = [badObs('TRADER:chain_paused', 'WARN')];
    for (const m of [0, 1, 40, 80]) await h.tick(m);
    assert.deepEqual(h.kinds(), ['open:WARN']);
  } finally {
    h.db.restore();
  }
});

test('silence suppresses notifications until silencedUntil', async () => {
  const h = await harness();
  const { silenceIncident } = await import('../src/services/ops-alerts/incidents');
  try {
    h.ev.next = [badObs()];
    await h.tick(0);
    await h.tick(1);
    await silenceIncident(h.incident().id, 120, at(2));
    await h.tick(40);
    await h.tick(80);
    h.ev.next = [];
    for (const m of [81, 82, 83]) await h.tick(m); // resolves while silenced: no resolve sent
    assert.equal(h.incident().state, 'RESOLVED');
    h.ev.next = [badObs()];
    await h.tick(90);
    await h.tick(91); // re-opens while still silenced
    assert.equal(h.incident().state, 'OPEN');
    assert.deepEqual(h.kinds(), ['open:CRITICAL'], 'only the pre-silence open');
    await h.tick(123); // silence over (minute 122): escalation resumes
    assert.deepEqual(h.kinds(), ['open:CRITICAL', 'escalate:CRITICAL']);
  } finally {
    h.db.restore();
  }
});

test('a subject re-opens at most once per ALERT_MIN_REOPEN_MS', async () => {
  const h = await harness();
  try {
    const seq: Array<[number, boolean]> = [[0, true], [1, true], [2, false], [3, false], [4, false], [5, true], [6, true]];
    for (const [m, isBad] of seq) {
      h.ev.next = isBad ? [badObs('TRADER:chain_paused', 'WARN')] : [];
      await h.tick(m);
    }
    assert.equal(h.incident('TRADER:chain_paused').episode, 2, 'the second episode is tracked');
    assert.deepEqual(h.kinds(), ['open:WARN', 'resolve:WARN'], 'but its open is not re-sent within 10 minutes');
  } finally {
    h.db.restore();
  }
});

test('50 stuck outbox rows of one kind are one incident', async () => {
  const h = await harness();
  const { outboxStuck } = await import('../src/services/ops-alerts/conditions');
  try {
    const nowSec = BigInt(Math.floor(at(0).getTime() / 1000));
    for (let i = 0; i < 50; i++) {
      h.db.tables.chainTransaction.push({
        id: `row-${i}`, kind: 'trade.buy', status: i % 2 ? 'SUBMITTED' : 'PENDING',
        maxTime: i === 7 ? nowSec - 60n : nowSec + 600n, createdAt: at(-60),
      });
    }
    h.db.tables.chainTransaction.push({ id: 'fresh', kind: 'trade.sell', status: 'PENDING', maxTime: nowSec + 600n, createdAt: at(-1) });
    const obs = await outboxStuck.evaluate(at(0));
    assert.equal(obs.length, 1);
    assert.equal(obs[0].subjectKey, 'outbox:trade.buy');
    assert.equal(obs[0].severity, 'CRITICAL', 'one row is past maxTime');
    assert.equal((obs[0].detail as any).count, 50);
    await h.tick(0, [outboxStuck]);
    await h.tick(1, [outboxStuck]);
    assert.equal(h.db.tables.alertIncident.length, 1);
    assert.deepEqual(h.kinds(), ['open:CRITICAL']);
  } finally {
    h.db.restore();
  }
});

test('the cron failure streak is read from cron_runs, written by every instance', async () => {
  const h = await harness();
  const { persistCronRun } = await import('../src/cron/registry');
  const { cronFailing } = await import('../src/services/ops-alerts/conditions');
  try {
    // Two instances fail the same job alternately; the streak is shared.
    await persistCronRun('trader', 'failure', at(0), 'rpc down');
    await persistCronRun('trader', 'failure', at(15), 'rpc down');
    assert.equal((await cronFailing.evaluate(at(15)))[0].bad, false, 'below ALERT_CRON_FAILURE_STREAK (3)');
    await persistCronRun('trader', 'failure', at(30), 'rpc down');
    const [obs] = await cronFailing.evaluate(at(30));
    assert.equal(obs.subjectKey, 'cron:trader');
    assert.equal(obs.bad, true);
    assert.equal((obs.detail as any).failureStreak, 3);
    await persistCronRun('trader', 'success', at(45));
    assert.equal((await cronFailing.evaluate(at(45)))[0].bad, false, 'a success resets the streak');
  } finally {
    h.db.restore();
  }
});

test('an instance that does not get the advisory lock does not evaluate', async () => {
  const h = await harness();
  try {
    h.ev.next = [badObs()];
    let release!: () => void;
    const slow = {
      subjectType: 'agent_pause',
      async evaluate() { await new Promise<void>((r) => { release = r; }); return [badObs()]; },
    };
    const first = h.engine.runAlertEvaluation({ evaluators: [slow as any], alerts: h.alerts, now: at(0), policy: POLICY, lock: h.lock as any });
    await new Promise((r) => setImmediate(r));
    let secondEvaluated = false;
    const watcher = { subjectType: 'agent_pause', async evaluate() { secondEvaluated = true; return []; } };
    const second = await h.engine.runAlertEvaluation({ evaluators: [watcher as any], alerts: h.alerts, now: at(0), policy: POLICY, lock: h.lock as any });
    assert.equal(second.evaluated, false);
    assert.equal(secondEvaluated, false);
    release();
    assert.equal((await first).evaluated, true);
  } finally {
    h.db.restore();
  }
});

test('sinks are called after the lock is released', async () => {
  const h = await harness();
  try {
    let heldWhileSending: boolean | null = null;
    const probe = { name: 'probe', send: async () => { heldWhileSending = h.lockState.held; } };
    const { AlertService } = await import('../src/services/alerts.service');
    const alerts = new AlertService({ sinks: [probe], sleep: async () => undefined });
    h.ev.next = [badObs()];
    for (const m of [0, 1]) await h.engine.runAlertEvaluation({ evaluators: [h.ev as any], alerts, now: at(m), policy: POLICY, lock: h.lock as any });
    assert.equal(heldWhileSending, false);
  } finally {
    h.db.restore();
  }
});

test('ALERT_ROUTES_JSON routes severities to sink families; INFO goes nowhere by default', async () => {
  const { routeSinks } = await import('../src/services/alerts.service');
  const sinks = [{ name: 'webhook-abc123', send: async () => undefined }, { name: 'webhook-def456', send: async () => undefined }, { name: 'slack', send: async () => undefined }];
  const names = (s: any[]) => s.map((x) => x.name);
  assert.deepEqual(names(routeSinks(sinks, 'CRITICAL', '')), ['webhook-abc123', 'webhook-def456', 'slack']);
  assert.deepEqual(names(routeSinks(sinks, 'INFO', '')), []);
  const routes = JSON.stringify({ CRITICAL: ['webhook', 'slack'], WARN: ['slack'], INFO: ['webhook-def456'] });
  assert.deepEqual(names(routeSinks(sinks, 'WARN', routes)), ['slack']);
  assert.deepEqual(names(routeSinks(sinks, 'INFO', routes)), ['webhook-def456']);
  assert.deepEqual(names(routeSinks(sinks, 'CRITICAL', routes)), ['webhook-abc123', 'webhook-def456', 'slack']);
});

test('queueAlertEvaluation coalesces a burst of pauses into one evaluation', async () => {
  const { queueAlertEvaluation, cancelQueuedAlertEvaluation } = await import('../src/services/ops-alerts/engine');
  let runs = 0;
  const run = async () => { runs++; };
  try {
    for (let i = 0; i < 5; i++) queueAlertEvaluation(run, 20);
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(runs, 1);
  } finally {
    cancelQueuedAlertEvaluation();
  }
});

test('pauseAgent notifies pause listeners after the pause commits', async () => {
  const controls = await import('../src/services/agent-controls.service');
  const { prisma } = await import('../src/lib/prisma');
  const p: any = prisma;
  const orig = p.$transaction;
  p.$transaction = async (fn: any) => fn({
    $queryRawUnsafe: async () => [],
    agentControl: { update: async () => ({}) },
    agentControlEvent: { create: async () => ({}) },
  });
  const seen: string[] = [];
  const off = controls.onAgentPaused((scope, source) => seen.push(`${scope}:${source}`));
  try {
    await controls.pauseAgent('TRADER', { reason: 'breaker', source: 'failure_breaker', actor: 'system' });
    assert.deepEqual(seen, ['TRADER:failure_breaker']);
  } finally {
    off();
    p.$transaction = orig;
  }
});

// ─── Dispute alerts are unchanged (#92) ──────────────────────────────────────

const disputeAlert = {
  level: 'CRITICAL' as const,
  title: 'Dispute review: DISAGREE',
  marketId: 'market-1',
  onChainMarketId: '7',
  proposedOutcome: 'YES',
  verdict: 'DISAGREE',
  windowRemainingSecs: 3600,
  links: { market: 'https://app.example/markets/7', cancelTx: 'https://api.example/admin/disputes/r1/cancel-tx' },
  detail: 'Independent evaluation says NO.',
};

test('the dispute webhook body is byte-identical to #92 and ops alerts use their own type', async () => {
  const { webhookSink, sign, SIGNATURE_HEADER } = await import('../src/services/alerts.service');
  const bodies: Array<{ body: string; sig: string }> = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { bodies.push({ body, sig: String(req.headers[SIGNATURE_HEADER.toLowerCase()]) }); res.end('ok'); });
  });
  await new Promise<void>((r) => server.listen(0, r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
  try {
    await webhookSink(url, 'shh').send(disputeAlert);
    const parsed = JSON.parse(bodies[0].body);
    const expected = JSON.stringify({ type: 'oracledesk.dispute_alert', sentAt: parsed.sentAt, alert: disputeAlert });
    assert.equal(bodies[0].body, expected, 'same keys, same order, no added kind');
    assert.equal(bodies[0].sig, sign('shh', expected));

    const ops = {
      kind: 'ops' as const, level: 'WARN' as const, severity: 'WARN' as const, subjectType: 'cron_failing', subjectKey: 'cron:trader',
      summary: 'Cron job trader failed 3 time(s) in a row', detail: { failureStreak: 3 }, state: 'OPEN' as const,
      incidentId: 'i1', episode: 1, notification: 'open' as const, adminUrl: 'https://api.example/api/v1/admin/alerts?id=i1',
    };
    await webhookSink(url, 'shh').send(ops);
    const opsBody = JSON.parse(bodies[1].body);
    assert.equal(opsBody.type, 'oracledesk.ops_alert');
    assert.deepEqual(opsBody.alert, ops);
  } finally {
    server.close();
  }
});

test('dispute deliveries keep reviewId:level:sink keys, row shape and once-per-level semantics', async () => {
  const db = await memoryDb();
  const { AlertService } = await import('../src/services/alerts.service');
  const sink = new RecordingSink('slack');
  const alerts = new AlertService({ sinks: [sink], sleep: async () => undefined });
  try {
    assert.deepEqual(await alerts.send('review-1', disputeAlert), ['slack']);
    assert.deepEqual(await alerts.send('review-1', disputeAlert), [], 'already delivered at this level');
    assert.equal(await alerts.delivered('review-1', 'CRITICAL'), true);
    assert.equal(sink.sent.length, 1);
    const [row] = db.tables.alertDelivery;
    assert.equal(row.dedupeKey, 'review-1:CRITICAL:slack');
    assert.deepEqual(Object.keys(row).sort(), ['attempts', 'dedupeKey', 'error', 'level', 'reviewId', 'sentAt', 'sink', 'status']);
  } finally {
    db.restore();
  }
});

// ─── Admin HTTP ──────────────────────────────────────────────────────────────

async function withServer(fn: (base: string) => Promise<void>) {
  const { default: app } = await import('../src/app');
  const server = app.listen(0);
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.close();
  }
}

test('HTTP: /admin/alerts needs admin.read; ack and silence need alerts.manage and are audited', async () => {
  const db = await memoryDb();
  const { signToken } = await import('../src/middlewares/auth.middleware');
  const { prisma } = await import('../src/lib/prisma');
  const p: any = prisma;
  const AUDITOR = Keypair.random().publicKey();
  const origAssignment = p.adminRoleAssignment.findUnique;
  // An auditor: admin.read, no alerts.manage.
  p.adminRoleAssignment.findUnique = async ({ where }: any) => (where.walletAddress === AUDITOR
    ? { roleName: 'auditor', role: { permissions: [{ permissionKey: 'admin.read' }, { permissionKey: 'treasury.read' }] } }
    : null);
  db.tables.alertIncident.push({
    id: '00000000-0000-4000-8000-0000000000aa', subjectType: 'agent_pause', subjectKey: 'TRADER:failure_breaker', severity: 'CRITICAL',
    state: 'OPEN', episode: 1, summary: 's', detail: null, badStreak: 2, goodStreak: 0, openedAt: new Date(), resolvedAt: null,
    ackedAt: null, ackedBy: null, silencedUntil: null, lastNotifiedAt: new Date(), escalations: 0, createdAt: new Date(), updatedAt: new Date(),
  });
  const ID = '00000000-0000-4000-8000-0000000000aa';
  const call = (base: string, path: string, token: string | null, body?: unknown) => fetch(`${base}/api/v1/admin${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  try {
    await withServer(async (base) => {
      const nobody = signToken('u1', Keypair.random().publicKey());
      const auditor = signToken('aud', AUDITOR);
      const admin = signToken('admin', ADMIN);

      assert.equal((await call(base, '/alerts', null)).status, 401);
      assert.equal((await call(base, '/alerts', nobody)).status, 403);
      const list = await call(base, '/alerts?state=OPEN&severity=CRITICAL', auditor);
      assert.equal(list.status, 200);
      const listed = await list.json();
      assert.equal(listed.data.length, 1);
      assert.equal(listed.meta?.total ?? listed.pagination?.total ?? 1, 1);
      assert.equal((await call(base, '/alerts?state=BOGUS', auditor)).status, 400);

      assert.equal((await call(base, `/alerts/${ID}/ack`, auditor, {})).status, 403, 'admin.read is not enough');
      assert.equal((await call(base, `/alerts/${ID}/silence`, auditor, { untilMinutes: 30 })).status, 403);

      const ack = await call(base, `/alerts/${ID}/ack`, admin, {});
      assert.equal(ack.status, 200);
      assert.equal(db.tables.alertIncident[0].ackedBy, ADMIN);
      assert.equal((await call(base, `/alerts/${ID}/silence`, admin, { untilMinutes: 1441 })).status, 400);
      assert.equal((await call(base, `/alerts/${ID}/silence`, admin, { untilMinutes: 30 })).status, 200);
      assert.ok(db.tables.alertIncident[0].silencedUntil > new Date());
      assert.equal((await call(base, '/alerts/not-a-uuid/ack', admin, {})).status, 400);

      await new Promise((r) => setTimeout(r, 20)); // audit rows are written on response finish
      const actions = db.tables.adminAuditLog.map((a) => `${a.action}|${a.target}`);
      assert.deepEqual(actions, [`POST /api/v1/admin/alerts/${ID}/ack|alerts.manage`, `POST /api/v1/admin/alerts/${ID}/silence|alerts.manage`]);
    });
  } finally {
    p.adminRoleAssignment.findUnique = origAssignment;
    db.restore();
  }
});
