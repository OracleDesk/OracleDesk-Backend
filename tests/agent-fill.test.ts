import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { setupTestEnv } from './helpers/env';
import { CONTRACTS } from '../src/config/contracts';
import { readContractEvents } from '../src/services/stellar/tx-inspect';
import { extractTradeFillFromResponse } from '../src/services/agent-fill.service';

setupTestEnv();

function makeMockTradeEvent(contractId: string, overrides: Record<string, unknown> = {}) {
  const topics = [
    nativeToScVal('Trade', { type: 'symbol' }),
  ];
  const data = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: nativeToScVal('market_id', { type: 'symbol' }), val: nativeToScVal(BigInt(overrides.market_id ?? 1), { type: 'u64' }) }),
    new xdr.ScMapEntry({ key: nativeToScVal('trader', { type: 'symbol' }), val: nativeToScVal(CONTRACTS.treasury, { type: 'address' }) }),
    new xdr.ScMapEntry({ key: nativeToScVal('outcome', { type: 'symbol' }), val: xdr.ScVal.scvVec([nativeToScVal('Yes', { type: 'symbol' })]) }),
    new xdr.ScMapEntry({ key: nativeToScVal('is_buy', { type: 'symbol' }), val: nativeToScVal(overrides.is_buy ?? true, { type: 'bool' }) }),
    new xdr.ScMapEntry({ key: nativeToScVal('collateral', { type: 'symbol' }), val: nativeToScVal(BigInt(overrides.collateral ?? 10_000_000), { type: 'i128' }) }),
    new xdr.ScMapEntry({ key: nativeToScVal('shares', { type: 'symbol' }), val: nativeToScVal(BigInt(overrides.shares ?? 19_500_000), { type: 'i128' }) }),
    new xdr.ScMapEntry({ key: nativeToScVal('fee', { type: 'symbol' }), val: nativeToScVal(BigInt(overrides.fee ?? 100_000), { type: 'i128' }) }),
    new xdr.ScMapEntry({ key: nativeToScVal('reserve_yes', { type: 'symbol' }), val: nativeToScVal(BigInt(overrides.reserve_yes ?? 90_000_000), { type: 'i128' }) }),
    new xdr.ScMapEntry({ key: nativeToScVal('reserve_no', { type: 'symbol' }), val: nativeToScVal(BigInt(overrides.reserve_no ?? 110_000_000), { type: 'i128' }) }),
  ]);

  return {
    contractId,
    body: {
      v0: () => ({
        topics: () => topics,
        data: () => data,
      }),
    },
  };
}

test('readContractEvents reads TransactionMeta v4 per-operation events and filters by contractId', () => {
  const otherContract = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';
  const marketEv = makeMockTradeEvent(CONTRACTS.marketCore, { collateral: 25_000_000, shares: 40_000_000 });
  const otherEv = makeMockTradeEvent(otherContract, { collateral: 99_000_000 });

  const response = {
    status: 'SUCCESS',
    ledger: 500123,
    resultMetaXdr: {
      switch: () => 4,
      v4: () => ({
        operations: () => [
          { events: () => [otherEv] },
          { events: () => [marketEv] },
        ],
      }),
    },
  } as any;

  const events = readContractEvents(response, CONTRACTS.marketCore);
  assert.equal(events.length, 1);
  assert.equal(events[0].contractId, CONTRACTS.marketCore);
  assert.equal(events[0].name, 'Trade');

  const fill = extractTradeFillFromResponse(response, { isBuy: true, onChainMarketId: 1n });
  assert.ok(fill);
  assert.equal(fill.collateral, 25_000_000n);
  assert.equal(fill.shares, 40_000_000n);
  assert.equal(fill.fee, 100_000n);
  assert.equal(fill.reserveYes, 90_000_000n);
  assert.equal(fill.reserveNo, 110_000_000n);
  assert.equal(fill.ledger, 500123);
  assert.equal(fill.source, 'rpc-event');
});
