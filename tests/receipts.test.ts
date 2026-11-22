import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv } from './helpers/env';

setupTestEnv();

test('receipt JWS signs, detaches, and verifies across key rotation', async () => {
  const {
    buildEntitlementKeySet,
    generateEntitlementKey,
    publicKeyValue,
  } = await import('../src/services/entitlement/keys');
  const {
    signReceiptDocument,
    toDetachedJws,
    verifyReceiptJws,
  } = await import('../src/services/receipt.service');

  const oldPriv = generateEntitlementKey();
  const newPriv = generateEntitlementKey();
  const oldSet = buildEntitlementKeySet(oldPriv, []);
  const rotatedSet = buildEntitlementKeySet(newPriv, [publicKeyValue(oldPriv)]);

  const doc = {
    version: 1 as const,
    receiptId: 'rcpt-1',
    type: 'DAILY_PASS' as const,
    userId: 'user-1',
    payer: 'GABC123',
    recipient: 'GDEST456',
    txHash: 'a'.repeat(64),
    ledger: 1000,
    ledgerCloseTime: '2026-11-20T10:00:00.000Z',
    events: [
      {
        contractId: 'CUSDC',
        from: 'GABC123',
        to: 'GDEST456',
        amountRaw: '50000000',
        opIndex: 0,
        eventIndex: 0,
        toMuxedId: null,
      },
    ],
    amountRaw: '50000000',
    currency: 'USDC' as const,
    product: {
      type: 'DAILY_PASS' as const,
      traceId: null,
      startsAt: '2026-11-20T10:00:00.000Z',
      endsAt: '2026-11-21T10:00:00.000Z',
    },
    priceVersion: 'v1',
    keyId: oldSet.current.kid,
    issuedAt: '2026-11-20T10:00:05.000Z',
  };

  const { compactJws, detachedJws } = signReceiptDocument(doc, oldSet.current);
  assert.equal(toDetachedJws(compactJws), detachedJws);

  // Verifies with rotated key set (old key in previous public keys)
  const verifiedCompact = verifyReceiptJws(compactJws, rotatedSet);
  assert.equal(verifiedCompact.receiptId, 'rcpt-1');

  const verifiedDetached = verifyReceiptJws(detachedJws, rotatedSet, doc);
  assert.equal(verifiedDetached.txHash, doc.txHash);

  // Rejects unknown key if old key is not in previous
  const unlinkedSet = buildEntitlementKeySet(newPriv, []);
  assert.throws(() => verifyReceiptJws(compactJws, unlinkedSet), (err: any) => err.code === 'UNKNOWN_RECEIPT_KEY');
});

test('redeemReceipt re-grants after restore and is idempotent on replay', async () => {
  const { prisma } = await import('../src/lib/prisma');
  const { buildEntitlementKeySet, generateEntitlementKey } = await import('../src/services/entitlement/keys');
  const { signReceiptDocument, redeemReceipt } = await import('../src/services/receipt.service');

  const priv = generateEntitlementKey();
  const keySet = buildEntitlementKeySet(priv, []);
  const txHash = 'b'.repeat(64);
  const doc = {
    version: 1 as const,
    receiptId: 'rcpt-restore-1',
    type: 'DAILY_PASS' as const,
    userId: 'user-restore',
    payer: 'GUSER1',
    recipient: 'GTREASURY1',
    txHash,
    ledger: 2048,
    ledgerCloseTime: '2026-11-20T10:00:00.000Z',
    events: [
      {
        contractId: 'CUSDC',
        from: 'GUSER1',
        to: 'GTREASURY1',
        amountRaw: '50000000',
        opIndex: 0,
        eventIndex: 0,
        toMuxedId: null,
      },
    ],
    amountRaw: '50000000',
    currency: 'USDC' as const,
    product: {
      type: 'DAILY_PASS' as const,
      traceId: null,
      startsAt: '2026-11-20T10:00:00.000Z',
      endsAt: '2026-11-21T10:00:00.000Z',
    },
    priceVersion: 'v1',
    keyId: keySet.current.kid,
    issuedAt: '2026-11-20T10:00:05.000Z',
  };
  const { compactJws } = signReceiptDocument(doc, keySet.current);

  const dbReceipts: any[] = [];
  const dbPayments: any[] = [];
  const dbSubs: any[] = [];

  const p: any = prisma;
  const orig = {
    tx: p.$transaction,
    rFind: p.receipt?.findFirst,
    peFind: p.paymentEvent.findUnique,
  };

  p.receipt = p.receipt ?? {};
  p.receipt.findFirst = async ({ where }: any) =>
    dbReceipts.find((r) => r.receiptId === where?.OR?.[0]?.receiptId || r.txHash === where?.OR?.[1]?.txHash || r.txHash === where?.txHash) ?? null;
  p.paymentEvent.findUnique = async ({ where }: any) =>
    dbPayments.find((pe) => pe.txHash === where.txHash) ?? null;

  p.$transaction = async (fn: any) => {
    const fakeTx = {
      $executeRaw: async () => 1,
      paymentEvent: {
        findUnique: async ({ where }: any) => dbPayments.find((pe) => pe.txHash === where.txHash) ?? null,
        create: async ({ data }: any) => {
          const row = { id: `pe-${dbPayments.length + 1}`, ...data };
          dbPayments.push(row);
          return row;
        },
      },
      subscription: {
        create: async ({ data }: any) => {
          const row = { id: `sub-${dbSubs.length + 1}`, ...data };
          dbSubs.push(row);
          return row;
        },
      },
      receipt: {
        findFirst: async ({ where }: any) => dbReceipts.find((r) => r.txHash === where.txHash) ?? null,
        create: async ({ data }: any) => {
          const row = { id: `rcpt-row-${dbReceipts.length + 1}`, ...data };
          dbReceipts.push(row);
          return row;
        },
      },
    };
    return fn(fakeTx);
  };

  try {
    // Wrong user rejected
    await assert.rejects(
      () => redeemReceipt({ jws: compactJws, requesterUserId: 'other-user' }, { keySet }),
      (err: any) => err.statusCode === 403 && err.code === 'RECEIPT_OWNER_MISMATCH',
    );

    // First redeem re-grants after restore
    const res1 = await redeemReceipt(
      { jws: compactJws, requesterUserId: 'user-restore' },
      {
        keySet,
        verifyChain: async () => ({
          txHash,
          from: 'GUSER1',
          to: 'GTREASURY1',
          amount: 50_000_000n,
          ledger: 2048,
          txSource: 'GUSER1',
          memo: { type: 'none', value: null },
          transfers: [],
          toMuxedId: null,
          createdAt: 1_763_632_800,
          envelopeMismatch: false,
        }),
      },
    );
    assert.equal(res1.status, 'REDEEMED');
    assert.equal(res1.redeemed, true);
    assert.equal(res1.chainVerified, true);
    assert.equal(dbSubs.length, 1);

    // Replay is idempotent and does not double-grant
    const res2 = await redeemReceipt({ jws: compactJws, requesterUserId: 'user-restore' }, { keySet });
    assert.equal(res2.status, 'ALREADY_PRESENT');
    assert.equal(res2.redeemed, false);
    assert.equal(dbSubs.length, 1);
  } finally {
    p.$transaction = orig.tx;
    if (orig.rFind) p.receipt.findFirst = orig.rFind;
    p.paymentEvent.findUnique = orig.peFind;
  }
});
