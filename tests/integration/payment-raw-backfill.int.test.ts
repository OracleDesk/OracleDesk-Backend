import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { Address, Keypair, rpc, xdr } from '@stellar/stellar-sdk';
import { integrationEnv, skipReason } from './setup';
import { transferEventData } from '../helpers/sac-meta';

/**
 * #224 phase A against a migrated database: the expand migration's defaults
 * let raw-only writers insert, and the backfill fills seeded legacy rows.
 */

let db: Awaited<ReturnType<typeof integrationEnv>>;
let prisma: import('@prisma/client').PrismaClient;
let truncateAll: typeof import('../helpers/db').truncateAll;
let backfill: typeof import('../../scripts/backfill-payment-raw');
let usdc: string;
let recipient: string;

before(async () => {
  db = await integrationEnv('payment_raw_backfill');
  if (!db) return;
  prisma = (await import('../../src/lib/prisma')).prisma;
  ({ truncateAll } = await import('../helpers/db'));
  backfill = await import('../../scripts/backfill-payment-raw');
  const contracts = await import('../../src/config/contracts');
  usdc = contracts.CONTRACTS.usdc;
  recipient = contracts.PAYMENTS_RECIPIENT;
});
beforeEach(async () => { if (db) await truncateAll(prisma); });
after(async () => { if (db) { await prisma.$disconnect(); await db.drop(); } });

/** Seed users, subscriptions, payment events and allowances (raw values only). */
async function insertSeed() {
  const { buildSeedData } = await import('../../src/seed/scenario');
  const data = buildSeedData({ seed: 3, marketCount: 4 });
  await prisma.user.createMany({ data: data.users });
  await prisma.subscription.createMany({ data: data.subscriptions.map((s) => ({ ...s, traceId: null })) });
  await prisma.paymentEvent.createMany({ data: data.paymentEvents });
  await prisma.spendingAllowance.createMany({ data: data.spendingAllowances });
  return data;
}

function chainReader(transfers: Map<string, { from: string; amount: bigint }>) {
  return {
    async getTransaction(txHash: string) {
      const t = transfers.get(txHash);
      if (!t) return { status: rpc.Api.GetTransactionStatus.NOT_FOUND, txHash } as any;
      const event = {
        type: () => ({ name: 'contract' }),
        contractId: () => new Address(usdc).toScAddress(),
        topics: [xdr.ScVal.scvSymbol('transfer'), new Address(t.from).toScVal(), new Address(recipient).toScVal()],
        data: transferEventData(t.amount),
      };
      return { status: rpc.Api.GetTransactionStatus.SUCCESS, txHash, ledger: 5_000, events: { contractEventsXdr: [[event]] } } as any;
    },
  };
}

test('raw-only seed rows insert under the phase A defaults', { skip: skipReason() }, async () => {
  const data = await insertSeed();
  const sub = await prisma.subscription.findUniqueOrThrow({ where: { id: data.subscriptions[0].id } });
  assert.equal(sub.amountPaid, 0, 'the float mirror takes its DEFAULT 0');
  assert.equal(sub.amountPaidRaw?.toFixed(), '5000000');
  const allowance = await prisma.spendingAllowance.findFirstOrThrow();
  assert.equal(allowance.dailyLimit, 0);
  assert.equal(allowance.dailyLimitRaw.toFixed(), '50000000');
});

test('backfill fills legacy float-only rows, verifies against the chain and is idempotent', { skip: skipReason() }, async () => {
  const data = await insertSeed();
  // Make every seeded payment look pre-#55: float only, no raw twin.
  await prisma.$executeRawUnsafe(`UPDATE "payment_events" SET "amountRaw" = NULL, "amount" = 0.5`);
  await prisma.$executeRawUnsafe(`UPDATE "subscriptions" SET "amountPaidRaw" = NULL, "amountPaid" = 0.5`);
  await prisma.$executeRawUnsafe(`UPDATE "subscriptions" SET "txHash" = NULL WHERE "id" = $1`, data.subscriptions[1].id);

  const onChain = data.paymentEvents[0];
  const deps = backfill.prismaBackfillDeps(prisma, {
    reader: chainReader(new Map([[onChain.txHash, { from: onChain.fromAddress, amount: 5_000_000n }]])),
    getHealth: async () => ({ oldestLedger: 1_000 }),
  });

  const dry = await backfill.runPaymentRawBackfill(deps, { apply: false });
  assert.equal(dry.paymentEvents.VERIFIED, 1);
  assert.equal(dry.paymentEvents.FLOAT_ONLY, data.paymentEvents.length - 1);
  assert.equal(await prisma.paymentEvent.count({ where: { amountRaw: null } }), data.paymentEvents.length, 'dry-run writes nothing');
  assert.equal(await prisma.paymentRawBackfill.count(), 0);

  const applied = await backfill.runPaymentRawBackfill(deps, { apply: true, batchSize: 5 });
  assert.equal(applied.exitCode, 0);
  assert.equal(await prisma.paymentEvent.count({ where: { amountRaw: null } }), 0);
  assert.equal(await prisma.subscription.count({ where: { amountPaidRaw: null } }), 0);
  assert.deepEqual(applied.subscriptionsWithoutTxHash, [data.subscriptions[1].id]);
  const verified = await prisma.paymentRawBackfill.findUniqueOrThrow({
    where: { table_rowId: { table: 'payment_events', rowId: onChain.id } },
  });
  assert.equal(verified.status, 'VERIFIED');
  assert.equal(verified.chainValue?.toFixed(), '5000000');
  const records = await prisma.paymentRawBackfill.count();
  assert.equal(records, data.paymentEvents.length + data.subscriptions.length);

  const rerun = await backfill.runPaymentRawBackfill(deps, { apply: true });
  assert.equal(rerun.applied.paymentEvents + rerun.applied.subscriptions, 0);
  assert.equal(await prisma.paymentRawBackfill.count(), records);
});
