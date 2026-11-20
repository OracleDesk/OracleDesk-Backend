import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv } from './helpers/env';

setupTestEnv();

test('market finality settles a position using raw shares and collateral', async () => {
  const { prisma } = await import('../src/lib/prisma');
  const { applyMarketFinality } = await import('../src/services/market-finality');
  const originals = {
    marketUpdateMany: prisma.market.updateMany,
    positionFindMany: prisma.position.findMany,
    positionUpdateMany: prisma.position.updateMany,
    positionUpdate: prisma.position.update,
    transaction: prisma.$transaction,
  };
  const updates: any[] = [];
  (prisma.market.updateMany as any) = async () => ({ count: 1 });
  (prisma.position.findMany as any) = async () => [{
    id: 'position-1',
    direction: 'YES',
    sharesRaw: '1000',
    costBasisRaw: '600',
    realisedCollateralRaw: '0',
    realisedPnlRaw: '-20',
  }];
  (prisma.position.updateMany as any) = async () => ({ count: 1 });
  (prisma.position.update as any) = async (args: any) => { updates.push(args); return args; };
  (prisma.$transaction as any) = async (arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg));

  try {
    assert.equal(await applyMarketFinality('market-1', 'Yes', new Date(), 42), true);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].where.id, 'position-1');
    assert.equal(updates[0].data.sharesRaw, '0');
    assert.equal(updates[0].data.costBasisRaw, '0');
    assert.equal(updates[0].data.realisedCollateralRaw, '1000');
    assert.equal(updates[0].data.realisedPnlRaw, '380');
    assert.equal(updates[0].data.unrealisedPnlRaw, '0');
    assert.equal(updates[0].data.markPriceBps, 10_000);
  } finally {
    (prisma.market.updateMany as any) = originals.marketUpdateMany;
    (prisma.position.findMany as any) = originals.positionFindMany;
    (prisma.position.updateMany as any) = originals.positionUpdateMany;
    (prisma.position.update as any) = originals.positionUpdate;
    (prisma.$transaction as any) = originals.transaction;
  }
});
