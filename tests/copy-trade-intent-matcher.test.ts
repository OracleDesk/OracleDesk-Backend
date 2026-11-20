import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Address, rpc, xdr } from '@stellar/stellar-sdk';
import { setupTestEnv } from './helpers/env';
import { CONTRACTS } from '../src/config/contracts';
import { CopyTradeStatus, reconcileFromTradeEvent } from '../src/services/copy-trade.service';
import { readContractEvents, setTransactionReader } from '../src/services/stellar/tx-inspect';

setupTestEnv();

const FIXTURES = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'tests', 'fixtures', 'events.json'), 'utf8'),
).events;
const BASE_TRADE_EVENT = FIXTURES[0];
const TRADER_ADDR = Address.fromScVal(
  xdr.ScVal.fromXDR(BASE_TRADE_EVENT.topic[2], 'base64'),
).toString();
const TX_HASH = '99'.repeat(32);
const LEDGER_CLOSED_AT = '2026-10-19T13:00:00.000Z';

function makeCopyTrade(
  id: string,
  status: CopyTradeStatus = CopyTradeStatus.PENDING,
  createdAt = new Date('2026-10-19T12:00:00Z'),
): any {
  return {
    id,
    userId: 'user-test',
    followerWallet: TRADER_ADDR,
    direction: 'YES',
    amountRaw: '200000000',
    status,
    txHash: null,
    failureCode: status === CopyTradeStatus.EXPIRED ? 'EXPIRED' : null,
    expiresAt: new Date('2026-10-19T13:30:00Z'),
    createdAt,
    market: { onChainMarketId: 0n },
  };
}

function makeEvent() {
  const parsed = readContractEvents({
    status: rpc.Api.GetTransactionStatus.SUCCESS,
    txHash: TX_HASH,
    ledger: 4951600,
    resultMetaXdr: { events: [BASE_TRADE_EVENT] },
  } as any)[0];
  return {
    id: 'indexed-event-id',
    contractId: parsed.contractId,
    contractName: 'marketCore' as const,
    eventName: parsed.name,
    ledger: 4951600,
    ledgerClosedAt: LEDGER_CLOSED_AT,
    txHash: TX_HASH,
    params: parsed.data,
  };
}

function makePrisma(rows: Map<string, any>) {
  const audits: any[] = [];
  const ambiguities: any[] = [];
  const prisma: any = {
    copyTrade: {
      findFirst: async () => null,
      findMany: async ({ where }: any) => [...rows.values()].filter((row) =>
        row.followerWallet === where.followerWallet &&
        row.direction === where.direction &&
        where.status.in.includes(row.status) &&
        row.txHash === null &&
        row.createdAt <= where.createdAt.lte &&
        row.market.onChainMarketId === where.market.onChainMarketId,
      ),
      updateMany: async ({ where, data }: any) => {
        const row = rows.get(where.id);
        if (!row || !where.status.in.includes(row.status)) return { count: 0 };
        if (!where.OR.some((condition: any) =>
          condition.txHash === null ? row.txHash === null : condition.txHash === row.txHash,
        )) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
      findUnique: async ({ where }: any) => rows.get(where.id) ?? null,
    },
    copyTradeAudit: {
      create: async ({ data }: any) => {
        audits.push(data);
        return data;
      },
    },
    copyTradeAmbiguity: {
      upsert: async ({ create, update }: any) => {
        const report = { ...create, ...update };
        ambiguities.push(report);
        return report;
      },
    },
  };
  prisma.$transaction = async (callback: any) => callback(prisma);
  return { prisma, audits, ambiguities };
}

function setSuccessfulReader() {
  setTransactionReader({
    async getTransaction(hash: string) {
      return {
        status: rpc.Api.GetTransactionStatus.SUCCESS,
        txHash: hash,
        ledger: 4951600,
        resultMetaXdr: { events: [BASE_TRADE_EVENT] },
      } as any;
    },
  });
}

test('matches an indexed buy to an eligible intent without a txHash', async () => {
  const copyTrade = makeCopyTrade('ct-no-hash');
  const { prisma, audits, ambiguities } = makePrisma(new Map([[copyTrade.id, copyTrade]]));
  setSuccessfulReader();

  const result = await reconcileFromTradeEvent(makeEvent(), prisma);

  assert.equal(result, 'confirmed');
  assert.equal(copyTrade.status, CopyTradeStatus.EXECUTED);
  assert.equal(copyTrade.txHash, TX_HASH);
  assert.equal(copyTrade.chainEventId, 'indexed-event-id');
  assert.equal(audits.length, 0);
  assert.equal(ambiguities.length, 0);
});

test('reports indistinguishable eligible intents instead of assigning the event', async () => {
  const createdAt = new Date('2026-10-19T12:00:00Z');
  const first = makeCopyTrade('ct-b', CopyTradeStatus.PENDING, createdAt);
  const second = makeCopyTrade('ct-a', CopyTradeStatus.PENDING, createdAt);
  const { prisma, ambiguities } = makePrisma(new Map([[first.id, first], [second.id, second]]));
  setSuccessfulReader();

  const result = await reconcileFromTradeEvent(makeEvent(), prisma);

  assert.equal(result, 'ambiguous');
  assert.equal(first.status, CopyTradeStatus.PENDING);
  assert.equal(second.status, CopyTradeStatus.PENDING);
  assert.deepEqual(ambiguities[0].candidateCopyTradeIds, ['ct-a', 'ct-b']);
  assert.equal(ambiguities[0].reason, 'COPY_TRADE_INTENT_AMBIGUOUS');
});

test('does not match intents created after the event or with insufficient approved collateral', async () => {
  const future = makeCopyTrade('ct-future', CopyTradeStatus.PENDING, new Date('2026-10-19T13:01:00Z'));
  const underfunded = makeCopyTrade('ct-underfunded');
  underfunded.amountRaw = '99999999';
  const { prisma } = makePrisma(new Map([[future.id, future], [underfunded.id, underfunded]]));
  setSuccessfulReader();

  const result = await reconcileFromTradeEvent(makeEvent(), prisma);

  assert.equal(result, 'ignored');
  assert.equal(future.status, CopyTradeStatus.PENDING);
  assert.equal(underfunded.status, CopyTradeStatus.PENDING);
});

test('late evidence restores an expired intent and writes an audit in the transition', async () => {
  const copyTrade = makeCopyTrade('ct-expired', CopyTradeStatus.EXPIRED);
  const { prisma, audits } = makePrisma(new Map([[copyTrade.id, copyTrade]]));
  setSuccessfulReader();

  const result = await reconcileFromTradeEvent(makeEvent(), prisma);

  assert.equal(result, 'confirmed');
  assert.equal(copyTrade.status, CopyTradeStatus.EXECUTED);
  assert.equal(copyTrade.failureCode, null);
  assert.deepEqual(audits, [{
    copyTradeId: 'ct-expired',
    fromStatus: CopyTradeStatus.EXPIRED,
    toStatus: CopyTradeStatus.EXECUTED,
    txHash: TX_HASH,
    chainEventId: 'indexed-event-id',
    reason: 'EXPIRED_INTENT_REVERIFIED',
  }]);
});
