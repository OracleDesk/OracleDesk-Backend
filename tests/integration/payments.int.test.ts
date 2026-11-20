import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { Account, Address, Keypair, Operation, TransactionBuilder, nativeToScVal, rpc } from '@stellar/stellar-sdk';
import { integrationEnv, skipReason } from './setup';

let db: Awaited<ReturnType<typeof integrationEnv>>;
let prisma: import('@prisma/client').PrismaClient;
let verification: typeof import('../../src/services/payment-verification.service');
let recordPayment: typeof import('../../src/services/subscription.service').recordPayment;
let truncateAll: typeof import('../helpers/db').truncateAll;
let makeUser: typeof import('../helpers/factories').makeUser;
let usdc: string;
let recipient: string;
let passphrase: string;

before(async () => {
  db = await integrationEnv('payments');
  if (!db) return;
  prisma = (await import('../../src/lib/prisma')).prisma;
  verification = await import('../../src/services/payment-verification.service');
  ({ recordPayment } = await import('../../src/services/subscription.service'));
  ({ truncateAll } = await import('../helpers/db'));
  ({ makeUser } = await import('../helpers/factories'));
  const contracts = await import('../../src/config/contracts');
  usdc = contracts.CONTRACTS.usdc;
  recipient = contracts.PAYMENTS_RECIPIENT;
  passphrase = (await import('../../src/config')).config.STELLAR_NETWORK_PASSPHRASE;
});
beforeEach(async () => { if (db) await truncateAll(prisma); });
after(async () => { if (db) { await prisma.$disconnect(); await db.drop(); } });

const PRICE = 5_000_000n;
const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: any) => e.code ?? e.message);

/** A successful USDC transfer of the pass price from `from`, served by a fake reader. */
function transferTx(from: string) {
  return new TransactionBuilder(new Account(from, '1'), { fee: '100', networkPassphrase: passphrase })
    .addOperation(Operation.invokeContractFunction({
      contract: usdc,
      function: 'transfer',
      args: [new Address(from).toScVal(), new Address(recipient).toScVal(), nativeToScVal(PRICE, { type: 'i128' })],
    }))
    .setTimeout(30)
    .build();
}

function useTransfer(from: string) {
  const tx = transferTx(from);
  return verification.setTransactionReader({
    async getTransaction(hash: string) {
      return { status: rpc.Api.GetTransactionStatus.SUCCESS, txHash: hash, ledger: 42, envelopeXdr: tx.toEnvelope() } as any;
    },
  });
}

/** Like useTransfer, but counts getTransaction calls so races can be asserted. */
function countingTransfer(from: string) {
  const tx = transferTx(from);
  const calls = { getTransaction: 0 };
  return {
    calls,
    reader: {
      async getTransaction(hash: string) {
        calls.getTransaction++;
        // Widen the race window so a non-serialized implementation would show it.
        await new Promise((r) => setTimeout(r, 25));
        return { status: rpc.Api.GetTransactionStatus.SUCCESS, txHash: hash, ledger: 42, envelopeXdr: tx.toEnvelope() } as any;
      },
    },
  };
}

test('grants pass once (idempotent re-submit)', { skip: skipReason() }, async () => {
  const user = await makeUser(prisma);
  const prev = useTransfer(user.walletAddress);
  try {
    const hash = 'ab'.repeat(32);
    const args = { userId: user.id, walletAddress: user.walletAddress, type: 'DAILY_PASS' as const, txHash: hash };
    const first = await recordPayment(args);
    const again = await recordPayment(args);
    assert.equal(again.id, first.id);
    assert.equal(await prisma.subscription.count(), 1);
    assert.equal(await prisma.paymentEvent.count(), 1);
  } finally {
    verification.setTransactionReader(prev);
  }
});

test('rejects hash reuse by another user', { skip: skipReason() }, async () => {
  const owner = await makeUser(prisma);
  const other = await makeUser(prisma);
  const hash = 'cd'.repeat(32);
  let prev = useTransfer(owner.walletAddress);
  try {
    await recordPayment({ userId: owner.id, walletAddress: owner.walletAddress, type: 'DAILY_PASS', txHash: hash });
  } finally {
    verification.setTransactionReader(prev);
  }
  prev = useTransfer(other.walletAddress);
  try {
    assert.equal(
      await code(recordPayment({ userId: other.id, walletAddress: other.walletAddress, type: 'DAILY_PASS', txHash: hash })),
      'PAYMENT_ALREADY_USED',
    );
  } finally {
    verification.setTransactionReader(prev);
  }
});

test('concurrent double claim by the same user yields one pass and one RPC call (#59)', { skip: skipReason() }, async () => {
  const user = await makeUser(prisma);
  const { reader, calls } = countingTransfer(user.walletAddress);
  const prev = verification.setTransactionReader(reader);
  try {
    const hash = 'ef'.repeat(32);
    const claim = () => code(recordPayment({ userId: user.id, walletAddress: user.walletAddress, type: 'DAILY_PASS' as const, txHash: hash }));
    const results = await Promise.all(Array.from({ length: 8 }, claim));
    assert.equal(await prisma.subscription.count(), 1);
    assert.equal(await prisma.paymentEvent.count(), 1);
    // The owner always gets success: the winner and every idempotent racer.
    assert.deepEqual(results, Array(8).fill('ok'));
    assert.equal(calls.getTransaction, 1, 'verification runs once per hash');
  } finally {
    verification.setTransactionReader(prev);
  }
});

test('concurrent claim by another user is always 409 and never verifies twice (#59)', { skip: skipReason() }, async () => {
  const owner = await makeUser(prisma);
  const other = await makeUser(prisma);
  const { reader, calls } = countingTransfer(owner.walletAddress);
  const prev = verification.setTransactionReader(reader);
  try {
    const hash = 'a1'.repeat(32);
    const claim = (u: typeof owner) => code(recordPayment({ userId: u.id, walletAddress: u.walletAddress, type: 'DAILY_PASS' as const, txHash: hash }));
    const results = await Promise.all([claim(owner), claim(other), claim(owner), claim(other), claim(other)]);
    assert.equal(await prisma.subscription.count(), 1);
    assert.equal(await prisma.paymentEvent.count(), 1);
    assert.equal(results[0], 'ok');
    assert.equal(results[2], 'ok');
    for (const r of [results[1], results[3], results[4]]) assert.equal(r, 'PAYMENT_ALREADY_USED');
    assert.equal(calls.getTransaction, 1, 'racers reuse the first result');
  } finally {
    verification.setTransactionReader(prev);
  }
});

test('an over-allowance payment is granted and flagged, never refused or dropped (#53)', { skip: skipReason() }, async () => {
  const user = await makeUser(prisma);
  // 1 base unit of daily and per-trace approval: the pass price overflows it.
  await prisma.spendingAllowance.create({
    data: {
      userId: user.id,
      dailyLimit: 0.0000001,
      perTraceLimit: 0.0000001,
      dailyLimitRaw: '1',
      perTraceLimitRaw: '1',
      windowStartedAt: new Date(),
    },
  });
  const { reader } = countingTransfer(user.walletAddress);
  const prev = verification.setTransactionReader(reader);
  try {
    const hash = 'b2'.repeat(32);
    const results = await Promise.all(
      Array.from({ length: 4 }, () => code(recordPayment({ userId: user.id, walletAddress: user.walletAddress, type: 'DAILY_PASS' as const, txHash: hash }))),
    );
    assert.deepEqual(results, Array(4).fill('ok'));
    assert.equal(await prisma.subscription.count(), 1);
    assert.equal(await prisma.subscription.count({ where: { status: 'ACTIVE' } }), 1);
    const event = await prisma.paymentEvent.findFirstOrThrow();
    assert.equal(event.allowanceOverage, true);
    assert.equal(event.allowanceOverageRaw?.toString(), (PRICE - 1n).toString());
    const allowance = await prisma.spendingAllowance.findUniqueOrThrow({ where: { userId: user.id } });
    assert.equal(allowance.overageRaw.toString(), (PRICE - 1n).toString());
  } finally {
    verification.setTransactionReader(prev);
  }
});

test.todo('rolls back on mid-transaction failure (needs a fault-injection hook in recordPayment)');

// ─── Allowance day buckets (#219) ─────────────────────────────────────────

function verified(n: number, from: string, amount: bigint, closeIso: string) {
  return {
    txHash: n.toString(16).padStart(2, '0').repeat(32),
    from,
    to: recipient,
    amount,
    ledger: 1000 + n,
    txSource: from,
    memo: { type: 'none' } as any,
    transfers: [],
    toMuxedId: null,
    createdAt: Math.floor(Date.parse(closeIso) / 1000),
    envelopeMismatch: false,
  };
}

test('concurrent pass claims and x402 commits never push spentRaw above dailyLimitRaw (#219)', { skip: skipReason() }, async () => {
  const { settleVerifiedTransfer, userPaymentLockKey } = await import('../../src/services/subscription.service');
  const { reserveAllowance, commitReservation } = await import('../../src/services/x402-allowance.service');
  const { withAdvisoryLocksWait } = await import('../../src/lib/advisory-lock');
  const user = await makeUser(prisma);
  const dailyLimit = 12_000_000n;
  await prisma.spendingAllowance.create({
    data: {
      userId: user.id, dailyLimit: 1.2, perTraceLimit: 0.3,
      dailyLimitRaw: dailyLimit.toString(), perTraceLimitRaw: '3000000', windowStartedAt: new Date(),
    },
  });
  const now = new Date();
  const close = now.toISOString();
  const reservations = await Promise.all(
    [1, 2, 3].map((i) => reserveAllowance({ payer: user.walletAddress, traceId: `t${i}`, amountRaw: 2_000_000n, nonce: `n${i}` }, now)),
  );
  // Pass claims (advisory lock, as recordPayment) race x402 commits (no advisory lock).
  await Promise.all([
    ...[10, 11, 12].map((n) =>
      withAdvisoryLocksWait([userPaymentLockKey(user.id)], (tx) =>
        settleVerifiedTransfer(tx, { userId: user.id, type: 'DAILY_PASS', transfer: verified(n, user.walletAddress, PRICE, close), now }),
      ),
    ),
    ...reservations.map((r, i) =>
      commitReservation({ reservationId: r.reservationId!, txHash: (20 + i).toString(16).repeat(32), ledgerCloseTime: close, amountRaw: 2_000_000n }, now),
    ),
  ]);
  const days = await prisma.allowanceDay.findMany({ where: { userId: user.id } });
  assert.equal(days.length, 1);
  const spent = BigInt(days[0].spentRaw.toString());
  const overage = BigInt(days[0].overageRaw.toString());
  assert.ok(spent <= dailyLimit, `spentRaw ${spent} exceeds the limit`);
  assert.equal(days[0].reservedRaw.toString(), '0');
  // Every unit of the 3 passes and 3 trace purchases is booked as spend or overage.
  assert.equal(spent + overage, 3n * PRICE + 3n * 2_000_000n);
  assert.equal(await prisma.allowanceCharge.count({ where: { userId: user.id, status: 'COMMITTED' } }), 6);
});

test('backfill builds per-day buckets that match payment_events (#219)', { skip: skipReason() }, async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const user = await makeUser(prisma);
  const events = [
    { n: 1, close: '2026-11-18T23:59:50Z', amountRaw: '5000000', overage: null },
    { n: 2, close: '2026-11-19T10:00:00Z', amountRaw: '5000000', overage: '2000000' },
    { n: 3, close: null, amountRaw: '3000000', overage: null },
  ];
  for (const e of events) {
    await prisma.paymentEvent.create({
      data: {
        userId: user.id, txHash: e.n.toString(16).padStart(2, '0').repeat(32), type: 'DAILY_PASS', amount: Number(e.amountRaw) / 1e7,
        amountRaw: e.amountRaw, status: 'CONFIRMED', ledgerCloseTime: e.close ? new Date(e.close) : null,
        confirmedAt: new Date('2026-11-19T12:00:00Z'), allowanceOverage: e.overage != null, allowanceOverageRaw: e.overage,
      },
    });
  }
  // Re-run the migration's backfill statements against the seeded rows.
  const sql = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'prisma', 'migrations', '20261120120000_allowance_day_buckets', 'migration.sql'),
    'utf8',
  );
  const statements = sql
    .slice(sql.indexOf('-- Backfill'))
    .split(/;\s*\n/)
    .map((s) => s.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n').trim())
    .filter(Boolean);
  for (const statement of statements) await prisma.$executeRawUnsafe(statement);

  const perDay = await prisma.$queryRawUnsafe<Array<{ day: string; total: string }>>(
    `SELECT COALESCE("ledgerCloseTime", "confirmedAt", "createdAt")::date::text AS day, SUM("amountRaw"::numeric)::text AS total
     FROM "payment_events" WHERE "userId" = $1 AND "status" = 'CONFIRMED' GROUP BY 1 ORDER BY 1`,
    user.id,
  );
  const buckets = await prisma.allowanceDay.findMany({ where: { userId: user.id }, orderBy: { day: 'asc' } });
  assert.deepEqual(
    buckets.map((b) => ({
      day: b.day.toISOString().slice(0, 10),
      total: (BigInt(b.spentRaw.toString()) + BigInt(b.overageRaw.toString())).toString(),
    })),
    perDay,
  );
  const d19 = buckets.find((b) => b.day.toISOString().startsWith('2026-11-19'))!;
  assert.equal(d19.overageRaw.toString(), '2000000');
  const inferred = await prisma.allowanceCharge.findMany({ where: { userId: user.id, dayInferred: true } });
  assert.equal(inferred.length, 1);
  assert.equal(inferred[0].txHash, '03'.repeat(32));
});
