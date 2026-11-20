import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { Keypair } from '@stellar/stellar-sdk';
import { setupTestEnv } from './helpers/env';
import { fakeAllowanceDb, seedAllowance, type FakeAllowanceDb } from './helpers/fake-allowance-db';

const HMAC_SECRET = 'x402-allowance-test-secret-0123456789abcdef';
process.env.X402_ALLOWANCE_HMAC_SECRET = HMAC_SECRET;
setupTestEnv();

const USDC = 10_000_000n;
const D = '2026-11-19';
const D1 = '2026-11-20';
const at = (iso: string) => new Date(iso);
const secs = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const hash = (n: number) => n.toString(16).padStart(2, '0').repeat(32);
const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: any) => e.code ?? e.message);

async function load() {
  const { prisma } = await import('../src/lib/prisma');
  const sub = await import('../src/services/subscription.service');
  const x402 = await import('../src/services/x402-allowance.service');
  return { prisma, sub, x402 };
}

/** Runs `fn` with the fake installed on the shared prisma client. */
async function withDb<T>(fn: (db: FakeAllowanceDb, mods: Awaited<ReturnType<typeof load>>) => Promise<T>): Promise<T> {
  const mods = await load();
  const db = fakeAllowanceDb();
  const restore = db.install(mods.prisma);
  try {
    return await fn(db, mods);
  } finally {
    restore();
  }
}

function transfer(n: number, amount: bigint, closeIso: string | null) {
  return {
    txHash: hash(n),
    from: Keypair.random().publicKey(),
    to: Keypair.random().publicKey(),
    amount,
    ledger: 100 + n,
    txSource: '',
    memo: { type: 'none' } as any,
    transfers: [],
    toMuxedId: null,
    createdAt: closeIso ? secs(closeIso) : null,
    envelopeMismatch: false,
  };
}

test('ledgerDay/chargeDayFor: close time wins, missing close time is inferred from now', async () => {
  const { chargeDayFor, ledgerDay } = await import('../src/lib/time');
  assert.equal(ledgerDay(at(`${D}T23:59:50Z`)).toISOString(), `${D}T00:00:00.000Z`);
  const late = chargeDayFor({ createdAt: secs(`${D}T23:59:50Z`) }, at(`${D1}T00:00:10Z`));
  assert.deepEqual(late, { day: at(`${D}T00:00:00Z`), inferred: false });
  const missing = chargeDayFor({ createdAt: null }, at(`${D1}T00:00:10Z`));
  assert.deepEqual(missing, { day: at(`${D1}T00:00:00Z`), inferred: true });
});

test('late claim for a 23:59:50 transfer is charged to the previous day', async () => {
  await withDb(async (db, { sub }) => {
    seedAllowance(db, { userId: 'u1', dailyLimitRaw: 2n * USDC, perTraceLimitRaw: USDC, windowStartedAt: at(`${D1}T00:00:00Z`) });
    db.allowances.get('u1')!.spentTodayRaw = '3000000';
    const result = await sub.settleVerifiedTransfer(db.client, {
      userId: 'u1',
      type: 'DAILY_PASS',
      transfer: transfer(1, 5_000_000n, `${D}T23:59:50Z`),
      now: at(`${D1}T00:00:10Z`),
    });
    assert.equal(result.overageRaw, 0n);
    assert.deepEqual(db.bucket('u1', D), { spentRaw: '5000000', reservedRaw: '0', overageRaw: '0' });
    assert.equal(db.bucket('u1', D1), null, 'the claim day is untouched');
    // The deprecated single-day mirror belongs to today; yesterday's charge leaves it alone.
    assert.equal(db.allowances.get('u1')!.spentTodayRaw, '3000000');
    const [charge] = db.charges;
    assert.equal(charge.source, 'PASS_CLAIM');
    assert.equal(charge.status, 'COMMITTED');
    assert.equal(charge.dayInferred, false);
    assert.equal(db.paymentEvents[0].metadata.allowanceDay, D);
  });
});

test('claims for D+1 then D produce two buckets with correct spent and overage', async () => {
  await withDb(async (db, { sub }) => {
    seedAllowance(db, { userId: 'u1', dailyLimitRaw: 7_000_000n, perTraceLimitRaw: 7_000_000n });
    const now = at(`${D1}T08:00:00Z`);
    const settle = (n: number, close: string) =>
      sub.settleVerifiedTransfer(db.client, { userId: 'u1', type: 'DAILY_PASS', transfer: transfer(n, 5_000_000n, close), now });

    await settle(1, `${D1}T07:00:00Z`);
    const over = await settle(2, `${D1}T07:30:00Z`);
    assert.equal(over.overageRaw, 3_000_000n);
    // The late claim for D lands on D and does not see D+1's spend.
    const late = await settle(3, `${D}T23:59:59Z`);
    assert.equal(late.overageRaw, 0n);

    assert.deepEqual(db.bucket('u1', D1), { spentRaw: '7000000', reservedRaw: '0', overageRaw: '3000000' });
    assert.deepEqual(db.bucket('u1', D), { spentRaw: '5000000', reservedRaw: '0', overageRaw: '0' });
    const allowance = db.allowances.get('u1')!;
    assert.equal(allowance.overageRaw, '3000000', 'lifetime overage');
    assert.equal(allowance.spentTodayRaw, '7000000', 'mirror follows today only');
    assert.equal(db.paymentEvents[1].allowanceOverage, true);
    assert.equal(db.paymentEvents[2].allowanceOverage, false);
  });
});

test('the same txHash charged twice books once', async () => {
  await withDb(async (db, { sub }) => {
    seedAllowance(db, { userId: 'u1', dailyLimitRaw: 6_000_000n, perTraceLimitRaw: 6_000_000n });
    const params = {
      userId: 'u1', type: 'DAILY_PASS' as const, amountRaw: 5_000_000n, day: at(`${D}T00:00:00Z`),
      source: 'PASS_CLAIM' as const, txHash: hash(7).toUpperCase(), now: at(`${D}T12:00:00Z`),
    };
    const first = await sub.chargeAllowance(db.client, params);
    const again = await sub.chargeAllowance(db.client, { ...params, amountRaw: 9_000_000n });
    assert.equal(first.replay, false);
    assert.equal(again.replay, true);
    assert.equal(again.chargeId, first.chargeId);
    assert.equal(again.overageRaw, 0n);
    assert.equal(db.charges.length, 1);
    assert.equal(db.charges[0].txHash, hash(7));
    assert.deepEqual(db.bucket('u1', D), { spentRaw: '5000000', reservedRaw: '0', overageRaw: '0' });
  });
});

test('payment-intent confirmation charges the ledger-close day', async () => {
  await withDb(async (db, { sub }) => {
    seedAllowance(db, { userId: 'u1', dailyLimitRaw: 4_000_000n, perTraceLimitRaw: 4_000_000n });
    // Same call submitPaymentIntent / confirmPendingPaymentIntents make.
    const result = await sub.settleVerifiedTransfer(db.client, {
      userId: 'u1',
      type: 'DAILY_PASS',
      transfer: transfer(2, 5_000_000n, `${D}T23:59:58Z`),
      paymentIntentId: 'pi-1',
      now: at(`${D1}T00:05:00Z`),
    });
    assert.equal(result.overageRaw, 1_000_000n, 'over-limit settlements are accepted and flagged');
    assert.deepEqual(db.bucket('u1', D), { spentRaw: '4000000', reservedRaw: '0', overageRaw: '1000000' });
    assert.equal(db.bucket('u1', D1), null);
    assert.equal(db.charges[0].source, 'PAYMENT_INTENT');
    assert.equal(db.paymentEvents[0].allowanceOverageRaw, '1000000');
  });
});

test('a transfer without RPC close time is charged to now and marked dayInferred', async () => {
  await withDb(async (db, { sub }) => {
    seedAllowance(db, { userId: 'u1', dailyLimitRaw: 9_000_000n, perTraceLimitRaw: 9_000_000n });
    await sub.settleVerifiedTransfer(db.client, {
      userId: 'u1', type: 'DAILY_PASS', transfer: transfer(3, 5_000_000n, null), now: at(`${D1}T03:00:00Z`),
    });
    assert.equal(db.charges[0].dayInferred, true);
    assert.equal(db.bucket('u1', D1)!.spentRaw, '5000000');
    assert.equal(db.allowances.get('u1')!.spentTodayRaw, '5000000');
  });
});

test('preauthorize subtracts reservedRaw and reports the checked day', async () => {
  await withDb(async (db, { sub }) => {
    seedAllowance(db, { userId: 'u1', dailyLimitRaw: 6_000_000n, perTraceLimitRaw: 6_000_000n });
    db.days.set(`u1|${D}`, { userId: 'u1', day: at(`${D}T00:00:00Z`), spentRaw: '2000000', reservedRaw: '3000000', overageRaw: '0' });
    const now = at(`${D}T23:59:58Z`);
    const tight = await sub.preauthorizeSpending('u1', 'PER_TRACE', 2_000_000n, now);
    assert.equal(tight.allowed, false);
    assert.equal(tight.reason, 'ALLOWANCE_DAILY_LIMIT');
    assert.equal(tight.dayStart, `${D}T00:00:00.000Z`);
    assert.equal(tight.spentTodayRaw, '2000000');
    assert.equal(tight.reservedRaw, '3000000');
    assert.equal(tight.remainingRaw, '1000000');
    assert.equal(tight.wouldOverflowRaw, '1000000');
    const fits = await sub.preauthorizeSpending('u1', 'PER_TRACE', 1_000_000n, now);
    assert.equal(fits.allowed, true);

    const view = await sub.getSpendingAllowance('u1', now);
    assert.equal(view.spentTodayRaw, '2000000');
    assert.equal(view.reservedRaw, '3000000');
    assert.equal(view.remainingRaw, '1000000');
  });
});

test('x402 reserve enforces per-trace and daily limits and is idempotent on (payer, nonce)', async () => {
  await withDb(async (db, { x402 }) => {
    const payer = Keypair.random().publicKey();
    seedAllowance(db, { userId: 'u1', identityKey: payer, dailyLimitRaw: 3_000_000n, perTraceLimitRaw: 2_000_000n });
    const now = at(`${D}T10:00:00Z`);
    const reserve = (amountRaw: bigint, nonce: string) =>
      x402.reserveAllowance({ payer, traceId: 't1', amountRaw, nonce }, now);

    assert.equal(await code(reserve(2_500_000n, 'n0')), 'ALLOWANCE_PER_TRACE_LIMIT');
    const first = await reserve(2_000_000n, 'n1');
    assert.equal(first.allowed, true);
    assert.ok(first.reservationId);
    const replay = await reserve(2_000_000n, 'n1');
    assert.equal(replay.reservationId, first.reservationId);
    assert.equal(db.bucket('u1', D)!.reservedRaw, '2000000', 'a replay reserves nothing more');
    // 2.0 reserved of 3.0: another 1.5 does not fit the day.
    assert.equal(await code(reserve(1_500_000n, 'n2')), 'ALLOWANCE_DAILY_LIMIT');
    assert.equal(await code(reserve(1_000_000n, 'n1')), 'ALLOWANCE_NONCE_REUSED');

    const released = await x402.releaseReservation(first.reservationId!);
    assert.equal(released.status, 'RELEASED');
    assert.equal(db.bucket('u1', D)!.reservedRaw, '0');
    assert.equal((await x402.releaseReservation(first.reservationId!)).released, false);

    const unknown = await x402.reserveAllowance({ payer: Keypair.random().publicKey(), traceId: 't1', amountRaw: 1n, nonce: 'n' }, now);
    assert.deepEqual(unknown, { allowed: true, active: false, reservationId: null });
  });
});

test('x402 payer resolves by identityKey, including a muxed sub-identity', async () => {
  const { MuxedAccount, Account } = await import('@stellar/stellar-sdk');
  const { payerIdentityKey } = await import('../src/services/x402-allowance.service');
  const base = Keypair.random().publicKey();
  const muxed = new MuxedAccount(new Account(base, '0'), '42').accountId();
  assert.equal(payerIdentityKey({ payer: base }), base);
  assert.equal(payerIdentityKey({ payer: muxed }), `${base}#muxed:42`);
  assert.equal(payerIdentityKey({ payer: base, subId: '7', subIdKind: 'MEMO' }), `${base}#memo:7`);
  assert.throws(() => payerIdentityKey({ payer: base, subId: '7' }), /subIdKind/);
});

test('reserve then commit across midnight moves the amount to the close day', async () => {
  await withDb(async (db, { x402 }) => {
    const payer = Keypair.random().publicKey();
    seedAllowance(db, { userId: 'u1', identityKey: payer, dailyLimitRaw: 5_000_000n, perTraceLimitRaw: 2_000_000n });
    const reserved = await x402.reserveAllowance({ payer, traceId: 't1', amountRaw: 1_000_000n, nonce: 'n1' }, at(`${D}T23:59:30Z`));
    assert.equal(db.bucket('u1', D)!.reservedRaw, '1000000');

    const committed = await x402.commitReservation(
      { reservationId: reserved.reservationId!, txHash: hash(9), ledgerCloseTime: `${D1}T00:00:03Z`, amountRaw: 1_000_000n },
      at(`${D1}T00:00:05Z`),
    );
    assert.equal(committed.day, D1);
    assert.equal(committed.late, false);
    assert.equal(committed.overageRaw, '0');
    assert.deepEqual(db.bucket('u1', D), { spentRaw: '0', reservedRaw: '0', overageRaw: '0' });
    assert.deepEqual(db.bucket('u1', D1), { spentRaw: '1000000', reservedRaw: '0', overageRaw: '0' });
    const charge = db.charges.find((c) => c.id === reserved.reservationId)!;
    assert.equal(charge.status, 'COMMITTED');
    assert.equal(charge.txHash, hash(9));
    assert.equal(charge.source, 'X402');
    assert.equal(charge.expiresAt, null);

    // Retried commit: stored result, nothing booked twice.
    const again = await x402.commitReservation(
      { reservationId: reserved.reservationId!, txHash: hash(9), ledgerCloseTime: secs(`${D1}T00:00:03Z`), amountRaw: 1_000_000n },
      at(`${D1}T00:00:09Z`),
    );
    assert.equal(again.replay, true);
    assert.equal(db.bucket('u1', D1)!.spentRaw, '1000000');
    assert.equal(
      await code(x402.commitReservation({ reservationId: reserved.reservationId!, txHash: hash(10), amountRaw: 1n })),
      'ALLOWANCE_RESERVATION_COMMITTED',
    );
  });
});

test('expired reservation is released by the sweep and a late commit is booked with overage', async () => {
  await withDb(async (db, { sub, x402 }) => {
    const payer = Keypair.random().publicKey();
    seedAllowance(db, { userId: 'u1', identityKey: payer, dailyLimitRaw: 2_000_000n, perTraceLimitRaw: 2_000_000n });
    const t0 = at(`${D}T10:00:00Z`);
    const reserved = await x402.reserveAllowance({ payer, traceId: 't1', amountRaw: 1_500_000n, nonce: 'n1' }, t0);

    assert.equal(await x402.expireAllowanceReservations(at(`${D}T10:00:30Z`)), 0, 'not yet expired');
    assert.equal(await x402.expireAllowanceReservations(at(`${D}T10:05:00Z`)), 1);
    assert.equal(db.charges[0].status, 'EXPIRED');
    assert.equal(db.bucket('u1', D)!.reservedRaw, '0');

    // The freed budget is used by a pass claim; claims never fail on reservations.
    await sub.chargeAllowance(db.client, {
      userId: 'u1', type: 'DAILY_PASS', amountRaw: 1_000_000n, day: t0, source: 'PASS_CLAIM', txHash: hash(1), now: t0,
    });

    // The x402 payment settled anyway: book it, flag what no longer fits.
    const late = await x402.commitReservation(
      { reservationId: reserved.reservationId!, txHash: hash(2), ledgerCloseTime: secs(`${D}T10:06:00Z`), amountRaw: 1_500_000n },
      at(`${D}T10:06:05Z`),
    );
    assert.equal(late.late, true);
    assert.equal(late.committed, true);
    assert.equal(late.overageRaw, '500000');
    assert.deepEqual(db.bucket('u1', D), { spentRaw: '2000000', reservedRaw: '0', overageRaw: '500000' });
    assert.equal(db.allowances.get('u1')!.overageRaw, '500000');
    assert.equal(db.charges.find((c) => c.id === reserved.reservationId)!.status, 'COMMITTED');
  });
});

test('commit for an unknown reservation is booked through the payer, or 404 without one', async () => {
  await withDb(async (db, { x402 }) => {
    const payer = Keypair.random().publicKey();
    seedAllowance(db, { userId: 'u1', identityKey: payer, dailyLimitRaw: 1_000_000n, perTraceLimitRaw: 1_000_000n });
    assert.equal(
      await code(x402.commitReservation({ reservationId: 'nope', txHash: hash(3), amountRaw: 1n })),
      'ALLOWANCE_RESERVATION_NOT_FOUND',
    );
    const booked = await x402.commitReservation(
      { reservationId: 'nope', txHash: hash(3), ledgerCloseTime: secs(`${D}T09:00:00Z`), amountRaw: 1_500_000n, payer: { payer }, traceId: 't9' },
      at(`${D}T09:00:02Z`),
    );
    assert.equal(booked.late, true);
    assert.equal(booked.overageRaw, '500000');
    assert.equal(booked.perTraceExceeded, true);
    assert.equal(db.charges[0].source, 'X402');
    assert.equal(db.charges[0].traceId, 't9');
  });
});

// ─── HTTP: service auth + routes ──────────────────────────────────────────

async function serviceApp() {
  const { default: express } = await import('express');
  const { captureRawBody } = await import('../src/middlewares/service-auth.middleware');
  const { errorMiddleware } = await import('../src/middlewares/error.middleware');
  const mw = await import('../src/middlewares/idempotency.middleware');
  const { default: routes } = await import('../src/routes/x402-allowance.routes');
  let n = 0;
  const prev = mw.setIdempotencyStore({
    claim: async () => `idem-${++n}`,
    find: async () => null,
    takeOver: async () => false,
    complete: async () => undefined,
    release: async () => undefined,
    purgeExpired: async () => 0,
  });
  const app = express();
  app.use(express.json({ verify: captureRawBody }));
  app.use('/api/v1/x402/allowance', routes);
  app.use(errorMiddleware);
  return { app, restore: () => mw.setIdempotencyStore(prev) };
}

async function signedPost(
  base: string,
  path: string,
  body: string,
  opts: { secret?: string; timestamp?: number; signBody?: string } = {},
) {
  const { serviceSignature } = await import('../src/middlewares/service-auth.middleware');
  const ts = String(opts.timestamp ?? Math.floor(Date.now() / 1000));
  const sig = serviceSignature(opts.secret ?? HMAC_SECRET, 'POST', path, ts, opts.signBody ?? body);
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': `k-${Math.random()}`,
      'x-oracledesk-timestamp': ts,
      'x-oracledesk-signature': sig,
    },
    body,
  });
}

test('HMAC service auth: wrong secret, stale timestamp or tampered body is 401', async () => {
  await withDb(async (db) => {
    const payer = Keypair.random().publicKey();
    seedAllowance(db, { userId: 'u1', identityKey: payer, dailyLimitRaw: 5_000_000n, perTraceLimitRaw: 1_000_000n });
    const { app, restore } = await serviceApp();
    const server = app.listen(0);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const path = '/api/v1/x402/allowance/reserve';
    const body = JSON.stringify({ payer, traceId: 't1', amountRaw: '500000', nonce: 'n1' });
    try {
      const wrong = await signedPost(base, path, body, { secret: 'not-the-secret-not-the-secret-0000' });
      assert.equal(wrong.status, 401);
      assert.equal((await wrong.json()).error.code, 'SERVICE_AUTH_INVALID');

      const stale = await signedPost(base, path, body, { timestamp: Math.floor(Date.now() / 1000) - 120 });
      assert.equal(stale.status, 401);

      const tampered = await signedPost(base, path, body.replace('500000', '400000'), { signBody: body });
      assert.equal(tampered.status, 401);

      const unsigned = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'k' }, body });
      assert.equal(unsigned.status, 401);
      assert.equal(db.charges.length, 0, 'nothing reserved by rejected calls');

      const ok = await signedPost(base, path, body);
      assert.equal(ok.status, 201);
      const okBody = await ok.json();
      assert.equal(okBody.data.allowed, true);
      assert.ok(okBody.data.reservationId);

      const overTrace = await signedPost(base, path, JSON.stringify({ payer, traceId: 't2', amountRaw: '1500000', nonce: 'n2' }));
      assert.equal(overTrace.status, 403);
      assert.equal((await overTrace.json()).error.code, 'ALLOWANCE_PER_TRACE_LIMIT');

      const release = await signedPost(base, '/api/v1/x402/allowance/release', JSON.stringify({ reservationId: okBody.data.reservationId }));
      assert.equal(release.status, 200);
      assert.equal((await release.json()).data.status, 'RELEASED');
    } finally {
      server.close();
      restore();
    }
  });
});

test('service routes require an Idempotency-Key', async () => {
  const { app, restore } = await serviceApp();
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const { serviceSignature } = await import('../src/middlewares/service-auth.middleware');
    const path = '/api/v1/x402/allowance/release';
    const body = JSON.stringify({ reservationId: 'r1' });
    const ts = String(Math.floor(Date.now() / 1000));
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-oracledesk-timestamp': ts,
        'x-oracledesk-signature': serviceSignature(HMAC_SECRET, 'POST', path, ts, body),
      },
      body,
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, 'IDEMPOTENCY_KEY_REQUIRED');
  } finally {
    server.close();
    restore();
  }
});
