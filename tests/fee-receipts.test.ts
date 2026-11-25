import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Account,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import { setupTestEnv } from './helpers/env';

setupTestEnv();

import {
  feeReceiptFrom,
  inclusionChargedOf,
  refundedResourceOf,
  recordFeeReceipt,
  resetFeeReceiptMetricsForTest,
  feeReceiptMetrics,
} from '../src/services/stellar/fee-receipt';
import { FeeOracle } from '../src/services/stellar/fees';
import { buildFeeBump, planBump } from '../src/services/stellar/fee-bump';
import { AlertService, type Alert, type AlertSink } from '../src/services/alerts.service';

function makeSorobanEnvelope(
  source: Keypair,
  opts: { inclusionFee: bigint; resourceFee: bigint },
) {
  const totalFee = opts.inclusionFee + opts.resourceFee;
  const tx = new TransactionBuilder(new Account(source.publicKey(), '100'), {
    fee: totalFee.toString(),
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.bumpSequence({ bumpTo: '101' }))
    .setTimeout(60)
    .build();

  // Attach SorobanTransactionData with the requested resourceFee onto the v1 tx ext
  const env = tx.toEnvelope();
  const sorobanData = new xdr.SorobanTransactionData({
    ext: xdr.SorobanTransactionDataExt.fromXDR(Buffer.from([0, 0, 0, 0])),
    resources: new xdr.SorobanResources({
      footprint: new xdr.LedgerFootprint({ readOnly: [], readWrite: [] }),
      instructions: 0,
      diskReadBytes: 0,
      writeBytes: 0,
    }),
    resourceFee: xdr.Int64.fromString(opts.resourceFee.toString()),
  });
  env.v1().tx().ext(xdr.TransactionExt.fromXDR(
    Buffer.concat([Buffer.from([0, 0, 0, 1]), sorobanData.toXDR()]),
  ));
  const rebuilt = TransactionBuilder.fromXDR(env.toXDR('base64'), Networks.TESTNET);
  rebuilt.sign(source);
  return rebuilt;
}

function makeTxResult(feeCharged: bigint, success: boolean): xdr.TransactionResult {
  const inner = success
    ? xdr.TransactionResultResult.txSuccess([])
    : xdr.TransactionResultResult.txFailed([]);
  return new xdr.TransactionResult({
    feeCharged: xdr.Int64.fromString(feeCharged.toString()),
    result: inner,
    ext: new xdr.TransactionResultExt(0),
  });
}

function makeFeeBumpResult(outerCharged: bigint, innerCharged: bigint, success: boolean): xdr.TransactionResult {
  const innerResult = new xdr.InnerTransactionResult({
    feeCharged: xdr.Int64.fromString(innerCharged.toString()),
    result: success
      ? xdr.InnerTransactionResultResult.txSuccess([])
      : xdr.InnerTransactionResultResult.txFailed([]),
    ext: new xdr.InnerTransactionResultExt(0),
  });
  const pair = new xdr.InnerTransactionResultPair({
    transactionHash: Buffer.alloc(32, 1),
    result: innerResult,
  });
  return new xdr.TransactionResult({
    feeCharged: xdr.Int64.fromString(outerCharged.toString()),
    result: success
      ? xdr.TransactionResultResult.txFeeBumpInnerSuccess(pair)
      : xdr.TransactionResultResult.txFeeBumpInnerFailed(pair),
    ext: new xdr.TransactionResultExt(0),
  });
}

function makeV3MetaWithExtV1(opts: { nonRefundable: bigint; refundable: bigint; rent: bigint } | null): xdr.TransactionMeta {
  const ext = opts
    ? xdr.SorobanTransactionMetaExt.sorobanTransactionMetaExtV1(
        new xdr.SorobanTransactionMetaExtV1({
          ext: new xdr.ExtensionPoint(0),
          totalNonRefundableResourceFeeCharged: xdr.Int64.fromString(opts.nonRefundable.toString()),
          totalRefundableResourceFeeCharged: xdr.Int64.fromString(opts.refundable.toString()),
          rentFeeCharged: xdr.Int64.fromString(opts.rent.toString()),
        }),
      )
    : new xdr.SorobanTransactionMetaExt(0);

  const sorobanMeta = new xdr.SorobanTransactionMeta({
    ext,
    events: [],
    returnValue: xdr.ScVal.scvVoid(),
    diagnosticEvents: [],
  });
  return xdr.TransactionMeta.transactionMetaV3(
    new xdr.TransactionMetaV3({
      ext: new xdr.ExtensionPoint(0),
      txChangesBefore: [],
      operations: [],
      txChangesAfter: [],
      sorobanMeta,
    }),
  );
}

test('feeReceiptFrom decodes plain Soroban transaction with SorobanTransactionMetaExtV1 refunds & rent', () => {
  const agent = Keypair.random();
  const tx = makeSorobanEnvelope(agent, { inclusionFee: 100_000n, resourceFee: 2_000_000n });
  const envXdr = tx.toEnvelope().toXDR('base64');
  const hash = tx.hash().toString('hex');

  const resp: any = {
    status: 'SUCCESS',
    txHash: hash,
    ledger: 123_456,
    resultXdr: makeTxResult(1_550_000n, true),
    resultMetaXdr: makeV3MetaWithExtV1({
      nonRefundable: 900_000n,
      refundable: 500_000n,
      rent: 50_000n,
    }),
  };

  const receipt = feeReceiptFrom(resp, envXdr);
  assert.equal(receipt.landedHash, hash);
  assert.equal(receipt.feeBumped, false);
  assert.equal(receipt.payer, agent.publicKey());
  assert.equal(receipt.innerSource, agent.publicKey());
  assert.equal(receipt.feeCharged, 1_550_000n);
  assert.equal(receipt.innerFeeCharged, null);
  assert.equal(receipt.nonRefundableResourceCharged, 900_000n);
  assert.equal(receipt.refundableResourceCharged, 500_000n);
  assert.equal(receipt.rentCharged, 50_000n);
  assert.equal(receipt.declaredFee, 2_100_000n);
  assert.equal(receipt.declaredResourceFee, 2_000_000n);
  assert.equal(receipt.ledger, 123_456);
  assert.equal(receipt.success, true);
  assert.equal(receipt.metaVersion, 3);
  assert.equal(inclusionChargedOf(receipt), 100_000n);
  assert.equal(refundedResourceOf(receipt), 600_000n);
});

test('feeReceiptFrom returns null components (not 0n) when SorobanTransactionMetaExtV1 is absent', () => {
  const agent = Keypair.random();
  const tx = makeSorobanEnvelope(agent, { inclusionFee: 50_000n, resourceFee: 1_000_000n });
  const resp: any = {
    status: 'FAILED',
    txHash: tx.hash().toString('hex'),
    ledger: 123_457,
    resultXdr: makeTxResult(900_000n, false),
    resultMetaXdr: makeV3MetaWithExtV1(null),
  };

  const receipt = feeReceiptFrom(resp, tx.toEnvelope().toXDR('base64'));
  assert.equal(receipt.success, false);
  assert.equal(receipt.feeCharged, 900_000n);
  assert.equal(receipt.nonRefundableResourceCharged, null);
  assert.equal(receipt.refundableResourceCharged, null);
  assert.equal(receipt.rentCharged, null);
  assert.equal(inclusionChargedOf(receipt), null);
  assert.equal(refundedResourceOf(receipt), null);
  assert.equal(receipt.metaVersion, 3);
});

test('feeReceiptFrom attributes fee-bumped transactions to the fee payer with separate innerFeeCharged', () => {
  const agent = Keypair.random();
  const feePayer = Keypair.random();
  const inner = makeSorobanEnvelope(agent, { inclusionFee: 100_000n, resourceFee: 2_000_000n });
  const plan = planBump(inner as any, 100_000n, { multiplier: 2, maxStroops: 10_000_000n });
  const outer = buildFeeBump(inner as any, plan, feePayer.publicKey(), Networks.TESTNET);
  outer.sign(feePayer);

  const outerHash = outer.hash().toString('hex');
  const resp: any = {
    status: 'SUCCESS',
    txHash: outerHash,
    ledger: 123_500,
    resultXdr: makeFeeBumpResult(1_900_000n, 1_500_000n, true),
    resultMetaXdr: makeV3MetaWithExtV1({
      nonRefundable: 950_000n,
      refundable: 450_000n,
      rent: 100_000n,
    }),
  };

  const receipt = feeReceiptFrom(resp, outer.toEnvelope().toXDR('base64'));
  assert.equal(receipt.feeBumped, true);
  assert.equal(receipt.landedHash, outerHash);
  assert.equal(receipt.payer, feePayer.publicKey());
  assert.equal(receipt.innerSource, agent.publicKey());
  assert.equal(receipt.feeCharged, 1_900_000n);
  assert.equal(receipt.innerFeeCharged, 1_500_000n);
  assert.equal(receipt.declaredResourceFee, 2_000_000n);
  assert.equal(inclusionChargedOf(receipt), 400_000n);
});

test('recordFeeReceipt is idempotent and never overwrites a RECEIPT with an ESTIMATE', async () => {
  resetFeeReceiptMetricsForTest();
  const store = new Map<string, any>();
  const fakePrisma: any = {
    chainFee: {
      findUnique: async ({ where }: any) => store.get(where.txHash) ?? null,
      upsert: async ({ where, create, update }: any) => {
        const existing = store.get(where.txHash);
        const next = existing ? { ...existing, ...update } : { ...create };
        store.set(where.txHash, next);
        return next;
      },
    },
  };

  const agent = Keypair.random();
  const tx = makeSorobanEnvelope(agent, { inclusionFee: 100_000n, resourceFee: 2_000_000n });
  const hash = tx.hash().toString('hex');
  const envXdr = tx.toEnvelope().toXDR('base64');

  const receipt = await recordFeeReceipt(
    { id: 'outbox-1', hash, envelopeXdr: envXdr, source: agent.publicKey() },
    'trade',
    { inclusionFee: 100_000n, resourceFee: 2_000_000n, totalFee: 2_100_000n },
    {
      status: 'SUCCESS',
      txHash: hash,
      ledger: 99,
      resultXdr: makeTxResult(1_400_000n, true),
      resultMetaXdr: makeV3MetaWithExtV1({ nonRefundable: 800_000n, refundable: 500_000n, rent: 0n }),
    },
    { prisma: fakePrisma },
  );

  assert.ok(receipt);
  assert.equal(store.get(hash)?.source, 'RECEIPT');
  assert.equal(store.get(hash)?.feeCharged, 1_400_000n);
  assert.equal(feeReceiptMetrics().recorded, 1);

  // Subsequent fallback call without resultXdr must NOT overwrite the RECEIPT with an ESTIMATE
  await recordFeeReceipt(
    { id: 'outbox-1', hash, envelopeXdr: null, source: agent.publicKey() },
    'trade',
    { inclusionFee: 100_000n, resourceFee: 2_000_000n, totalFee: 2_100_000n },
    { status: 'SUCCESS', ledger: 99 },
    { prisma: fakePrisma },
  );
  assert.equal(store.get(hash)?.source, 'RECEIPT');
  assert.equal(store.get(hash)?.feeCharged, 1_400_000n);
});

test('FeeOracle.refreshObservedMetrics computes ratios, warns and alerts above 80% budget without changing budgets', async () => {
  const sent: Alert[] = [];
  const sink: AlertSink = {
    name: 'test-sink',
    async send(a) { sent.push(a); },
  };
  const deliveries: any[] = [];
  const { prisma: globalPrisma } = await import('../src/lib/prisma');
  const prevFindUnique = (globalPrisma.alertDelivery as any).findUnique;
  const prevUpsert = (globalPrisma.alertDelivery as any).upsert;
  (globalPrisma.alertDelivery as any).findUnique = async ({ where }: any) =>
    deliveries.find((d) => d.dedupeKey === where.dedupeKey) ?? null;
  (globalPrisma.alertDelivery as any).upsert = async ({ create }: any) => {
    deliveries.push(create);
    return create;
  };

  try {
    // trade budget is 25,000,000 stroops; 80% is 20,000,000 -> feed receipts at 22,000,000
    const fakePrisma: any = {
      chainFee: {
        findMany: async ({ where }: any) => {
          if (where.opClass === 'trade') {
            return [
              { resourceFee: 25_000_000n, nonRefundableCharged: 15_000_000n, refundableCharged: 7_000_000n },
              { resourceFee: 25_000_000n, nonRefundableCharged: 14_000_000n, refundableCharged: 6_000_000n },
            ];
          }
          return [];
        },
      },
    };

    const oracle = new FeeOracle('Test SDF Network ; September 2015', 'http://127.0.0.1:8000');
    const budgetBefore = oracle.getPolicies().trade.budget;
    await oracle.refreshObservedMetrics({
      prisma: fakePrisma,
      alerts: new AlertService({ sinks: [sink], sleep: async () => undefined }),
      now: new Date('2026-10-20T12:00:00Z'),
    });

    assert.equal(oracle.getPolicies().trade.budget, budgetBefore, 'budgets must not be mutated automatically');
    assert.equal(oracle.p95ChargedResource('trade'), 22_000_000n);
    const ratio = oracle.observedResourceRatio('trade');
    assert.ok(ratio !== null && Math.abs(ratio - 0.84) < 1e-6);
    assert.equal(oracle.getSnapshot().observed.trade.warning, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].kind, 'fee_budget');
  } finally {
    (globalPrisma.alertDelivery as any).findUnique = prevFindUnique;
    (globalPrisma.alertDelivery as any).upsert = prevUpsert;
  }
});
