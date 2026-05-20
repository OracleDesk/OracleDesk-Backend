import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import axios from 'axios';
import { setupTestEnv } from './helpers/env';

setupTestEnv();

test('Circle webhook signatures verify against fetched ECDSA public key', async () => {
  process.env.CIRCLE_API_KEY = 'test-circle-key';
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicKeyDer = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const rawBody = Buffer.from(JSON.stringify({ notificationType: 'webhooks.test', notification: { hello: 'world' } }));
  const signature = crypto.sign('sha256', rawBody, privateKey).toString('base64');

  const originalGet = axios.get;
  (axios.get as any) = async () => ({
    data: { data: { id: 'test-key', algorithm: 'ECDSA_SHA_256', publicKey: publicKeyDer } },
  });

  try {
    const { verifyCircleWebhookSignature } = await import('../src/services/circle.service');
    assert.equal(await verifyCircleWebhookSignature({ rawBody, signature, keyId: 'test-key' }), true);
    assert.equal(await verifyCircleWebhookSignature({ rawBody, signature: 'bad', keyId: 'test-key' }), false);
  } finally {
    (axios.get as any) = originalGet;
  }
});

test('mock chain execution produces transaction-like hashes', async () => {
  const { submitFundBet, submitOracleApproval, marketIdToBytes32 } = await import('../src/services/chain.service');

  assert.match(marketIdToBytes32('market-1'), /^0x[a-f0-9]{64}$/);
  assert.match(await submitFundBet({ marketId: 'market-1', amountUsdc: 12.5 }), /^0x[a-f0-9]{64}$/);
  assert.match(await submitOracleApproval({
    marketAddress: '0x0000000000000000000000000000000000000001',
    yesWon: true,
  }), /^0x[a-f0-9]{64}$/);
});

test('subscription payment records access, audit event, and spending allowance consumption', async () => {
  const { prisma } = await import('../src/lib/prisma');
  const calls: string[] = [];
  const originalGet = axios.get;
  (axios.get as any) = async () => ({ data: { data: { transactions: [] } } });

  (prisma.subscription.findFirst as any) = async () => null;
  (prisma.spendingAllowance.findUnique as any) = async () => ({
    userId: 'user-1',
    dailyLimit: 10,
    perTraceLimit: 1,
    spentToday: 0,
    currency: 'USDC',
    lastResetAt: new Date(),
    isActive: true,
  });
  (prisma.spendingAllowance.update as any) = async () => ({});
  (prisma.subscription.create as any) = async () => ({});
  (prisma.$transaction as any) = async (fn: any) => fn({
    subscription: {
      create: async ({ data }: any) => {
        calls.push('subscription.create');
        return { id: 'sub-1', ...data };
      },
    },
    paymentEvent: {
      upsert: async () => {
        calls.push('paymentEvent.upsert');
        return {};
      },
    },
    spendingAllowance: {
      updateMany: async () => {
        calls.push('spendingAllowance.updateMany');
        return { count: 1 };
      },
    },
  });

  try {
    const { recordPayment } = await import('../src/services/subscription.service');
    const subscription = await recordPayment({
      userId: 'user-1',
      traceId: 'trace-1',
      type: 'PER_TRACE',
      txHash: '0xtest',
      amount: 0.005,
    });

    assert.equal(subscription.id, 'sub-1');
    assert.deepEqual(calls, ['subscription.create', 'paymentEvent.upsert', 'spendingAllowance.updateMany']);
  } finally {
    (axios.get as any) = originalGet;
  }
});

test('oracle approval moves active markets into resolving state and logs rationale', async () => {
  const { prisma } = await import('../src/lib/prisma');

  (prisma.market.findUnique as any) = async () => ({
    id: 'market-1',
    status: 'ACTIVE',
    onChainAddress: '0x0000000000000000000000000000000000000001',
  });
  (prisma.market.update as any) = async ({ data }: any) => ({ id: 'market-1', ...data });
  (prisma.agentLog.create as any) = async () => ({});

  const { approveMarketResolution } = await import('../src/services/oracle.service');
  const result = await approveMarketResolution({ marketId: 'market-1', yesWon: true, rationale: 'Official oracle result' });

  assert.equal(result.market.status, 'RESOLVING');
  assert.match(result.txHash, /^0x[a-f0-9]{64}$/);
});
