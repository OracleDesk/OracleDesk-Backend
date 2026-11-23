import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv } from './helpers/env';

setupTestEnv();

test('selectClaimableTransfers orders deterministically by (opIndex, eventIndex) and selects minimal prefix', async () => {
  const { selectClaimableTransfers } = await import('../src/services/payment-verification.service');
  const transfers = [
    { contractId: 'C1', from: 'G1', to: 'G2', amount: 3_000_000n, toMuxedId: null, opIndex: 1, eventIndex: 0, asset: null },
    { contractId: 'C1', from: 'G1', to: 'G2', amount: 2_000_000n, toMuxedId: null, opIndex: 0, eventIndex: 2, asset: null },
    { contractId: 'C1', from: 'G1', to: 'G2', amount: 1_000_000n, toMuxedId: null, opIndex: 0, eventIndex: 0, asset: null },
  ];

  const ordered = selectClaimableTransfers({ transfers });
  assert.deepEqual(ordered.map((t) => [t.opIndex, t.eventIndex]), [
    [0, 0],
    [0, 2],
    [1, 0],
  ]);

  const prefix = selectClaimableTransfers({ transfers }, 2_500_000n);
  assert.deepEqual(prefix.map((t) => [t.opIndex, t.eventIndex]), [
    [0, 0],
    [0, 2],
  ]);
});

test('claimTransferEvents rejects cross-channel duplicate claims with 409 PAYMENT_TRANSFER_ALREADY_CLAIMED and audits conflict', async () => {
  const { prisma } = await import('../src/lib/prisma');
  const { claimTransferEvents, claimX402Settlement } = await import('../src/services/payment-claims.service');

  const store = new Set<string>();
  const audits: any[] = [];
  const origLogCreate = prisma.agentLog.create;
  (prisma.agentLog.create as any) = async ({ data }: any) => {
    audits.push(data);
    return { id: 'audit-1', ...data };
  };

  const fakeTx: any = {
    paymentClaim: {
      create: async ({ data }: any) => {
        const key = `${data.txHash}:${data.opIndex}:${data.eventIndex}`;
        if (store.has(key)) {
          const err: any = new Error('Unique constraint failed');
          err.code = 'P2002';
          throw err;
        }
        store.add(key);
        return { id: `claim-${store.size}`, ...data };
      },
    },
  };

  try {
    const txHash = 'a'.repeat(64);
    await claimX402Settlement(fakeTx, {
      txHash,
      userId: 'u1',
      amountRaw: 1_000_000n,
      transfers: [{ opIndex: 0, eventIndex: 0, amount: 1_000_000n }],
    });

    // Attempting to claim the same event via LEGACY_UNLOCK fails with 409 PAYMENT_TRANSFER_ALREADY_CLAIMED
    await assert.rejects(
      () =>
        claimTransferEvents(fakeTx, {
          txHash,
          channel: 'LEGACY_UNLOCK',
          userId: 'u1',
          transfers: [{ opIndex: 0, eventIndex: 0, amount: 1_000_000n }],
        }),
      (err: any) => err.statusCode === 409 && err.code === 'PAYMENT_TRANSFER_ALREADY_CLAIMED',
    );

    assert.equal(audits.length, 1);
    assert.equal(audits[0].action, 'PAYMENT_CLAIM_CONFLICT');

    // A second distinct event in the same txHash (opIndex: 0, eventIndex: 1) CAN be claimed
    const second = await claimTransferEvents(fakeTx, {
      txHash,
      channel: 'LEGACY_UNLOCK',
      userId: 'u1',
      transfers: [{ opIndex: 0, eventIndex: 1, amount: 5_000_000n }],
    });
    assert.equal(second.length, 1);
    assert.equal(second[0].eventIndex, 1);
  } finally {
    (prisma.agentLog.create as any) = origLogCreate;
  }
});
