import test from 'node:test';
import assert from 'node:assert/strict';
import { X402SettlementService } from '../src/services/x402-settlement.service';

test('x402 settlement verifies the facilitator entry before recording access', async () => {
  const calls: string[] = [];
  const service = new X402SettlementService({
    fetchPayment: async () => ({ state: 'settled', traceId: 'trace-1', traceHash: 'hash', payer: 'GUSER', payTo: 'GDEST', amountRaw: '42', settlementTx: 'a'.repeat(64) }),
    verifyTransfer: async (input) => calls.push(`${input.from}:${input.to}:${input.minAmount}`),
    recordSettlement: async (input) => { calls.push(input.traceId); return { subscriptionId: 'sub-1' }; },
  });
  assert.deepEqual(await service.ingest({ paymentId: 'pay-1', userId: 'user-1', wallet: 'GUSER', traceId: 'trace-1' }), { status: 'RECORDED', subscriptionId: 'sub-1' });
  assert.deepEqual(calls, ['GUSER:GDEST:42', 'trace-1']);
});
