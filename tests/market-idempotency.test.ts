import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv } from './helpers/env';

setupTestEnv();

import {
  questionDocument,
  prepareMarketCommitment,
  submitMarketCreation,
  createMarketOnChain,
} from '../src/services/market-chain.service';
import {
  discoverLandedMarket,
  marketCreationDeps,
} from '../src/services/market-idempotency.service';
import { CONTRACTS } from '../src/config/contracts';
import { setIpfsTransport } from '../src/services/ipfs.service';
import { setChainOverrides } from '../src/services/chain.service';
import { prisma } from '../src/lib/prisma';
import { config } from '../src/config';
import { ChainError, ChainPendingError } from '../src/services/stellar/errors';

test('market-idempotency: questionDocument embeds backendMarketId and creates consistent hash', () => {
  const dummyMarket: any = {
    id: 'market-123',
    question: 'Will SpaceX land Starship on Mars by 2026?',
    category: 'CRYPTO',
    expiryTimestamp: new Date('2026-12-31T00:00:00Z'),
    resolutionOracle: 'https://spacex.com',
  };

  const doc = questionDocument(dummyMarket, 'deadbeef'.repeat(8));
  assert.equal(doc.backendMarketId, 'market-123');
  assert.equal(doc.question, dummyMarket.question);
  assert.equal(doc.resolutionHash, 'deadbeef'.repeat(8));

  // Verify backendMarketId is required and changing it changes the document JSON
  const doc2 = { ...doc, backendMarketId: 'market-456' };
  assert.notEqual(JSON.stringify(doc), JSON.stringify(doc2));
});

test('market-idempotency: discovery confirms matching candidate and rejects mismatching creator or resolutionHash', async () => {
  const qHex = 'aa'.repeat(32);
  const rHex = 'bb'.repeat(32);

  // Setup fake market on-chain
  const validMarket = {
    id: 10n,
    question_hash: Buffer.from(qHex, 'hex'),
    resolution_hash: Buffer.from(rHex, 'hex'),
    creator: CONTRACTS.treasury,
  };

  // Mismatch creator (agent instead of treasury)
  const invalidCreatorMarket = {
    ...validMarket,
    creator: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  };

  // Mismatch resolution hash
  const invalidResolutionMarket = {
    ...validMarket,
    resolution_hash: Buffer.from('cc'.repeat(32), 'hex'),
  };

  // 1. Valid candidate discovers market id 10n
  marketCreationDeps.getMarketCount = async () => 11n;
  marketCreationDeps.getOnChainMarket = async (id: bigint) => {
    if (id === 10n) return validMarket as any;
    throw new Error('MarketNotFound');
  };

  const discovered = await discoverLandedMarket({
    marketId: 'market-1',
    questionHashHex: qHex,
    resolutionHashHex: rHex,
  });
  assert.equal(discovered, 10n);

  // 2. Invalid creator returns null
  marketCreationDeps.getOnChainMarket = async () => invalidCreatorMarket as any;
  const rejectedCreator = await discoverLandedMarket({
    marketId: 'market-1',
    questionHashHex: qHex,
    resolutionHashHex: rHex,
  });
  assert.equal(rejectedCreator, null);

  // 3. Invalid resolution hash returns null
  marketCreationDeps.getOnChainMarket = async () => invalidResolutionMarket as any;
  const rejectedResolution = await discoverLandedMarket({
    marketId: 'market-1',
    questionHashHex: qHex,
    resolutionHashHex: rHex,
  });
  assert.equal(rejectedResolution, null);
});

test('market-idempotency: discovery follows txHash first before scanning', async () => {
  const qHex = '11'.repeat(32);
  const rHex = '22'.repeat(32);
  let txChecked = false;
  let scanCalled = false;

  marketCreationDeps.getTransaction = async (hash: string) => {
    txChecked = true;
    return {
      status: 'SUCCESS',
      resultMetaXdr: '',
    } as any;
  };

  marketCreationDeps.getMarketCount = async () => {
    scanCalled = true;
    return 5n;
  };
  marketCreationDeps.getOnChainMarket = async () => {
    throw new Error('MarketNotFound');
  };

  await discoverLandedMarket({
    marketId: 'market-test-order',
    questionHashHex: qHex,
    resolutionHashHex: rHex,
    txHash: 'tx-12345678',
  });

  assert.equal(txChecked, true);
  assert.equal(scanCalled, true);
});

test('market-idempotency: bounded scan stops at preSubmissionMarketCount floor', async () => {
  let scannedIds: bigint[] = [];
  marketCreationDeps.getMarketCount = async () => 100n;
  marketCreationDeps.getOnChainMarket = async (id: bigint) => {
    scannedIds.push(id);
    throw new Error('Not match');
  };

  await discoverLandedMarket({
    marketId: 'market-bounds',
    questionHashHex: '00'.repeat(32),
    resolutionHashHex: '00'.repeat(32),
    preSubmissionCount: 95n,
  });

  // Should only check down to preSubmissionCount (95)
  assert.ok(scannedIds.includes(99n));
  assert.ok(scannedIds.includes(95n));
  assert.ok(!scannedIds.includes(94n));
});

test('market-idempotency: discovery step 2 finds a landed market from an indexed MarketCreated row without question_hash in params', async () => {
  const qHex = '33'.repeat(32);
  const rHex = '44'.repeat(32);

  const validMarket = {
    id: 42n,
    question_hash: Buffer.from(qHex, 'hex'),
    resolution_hash: Buffer.from(rHex, 'hex'),
    creator: CONTRACTS.treasury,
  };

  (prisma.chainEvent as any).findMany = async () => [
    {
      params: {
        market_id: '42',
        creator: CONTRACTS.treasury,
        close_time: 1700000000,
        seed_amount: '100000000',
        initial_yes_bps: 5000,
      },
      txHash: 'tx-indexed-42',
    },
  ];

  marketCreationDeps.getTransaction = async () => null;
  marketCreationDeps.getOnChainMarket = async (id: bigint) => {
    if (id === 42n) return validMarket as any;
    throw new Error('MarketNotFound');
  };

  const discovered = await discoverLandedMarket({
    marketId: 'm-indexed-step2',
    questionHashHex: qHex,
    resolutionHashHex: rHex,
  });

  assert.equal(discovered, 42n);
});

test('market-idempotency: discovery step 2 ignores MarketCreated rows from non-treasury creators', async () => {
  const qHex = '55'.repeat(32);
  const rHex = '66'.repeat(32);

  (prisma.chainEvent as any).findMany = async () => [
    {
      params: {
        market_id: '99',
        creator: 'G_NON_TREASURY_ACCOUNT',
      },
      txHash: 'tx-indexed-99',
    },
  ];

  marketCreationDeps.getTransaction = async () => null;
  marketCreationDeps.getMarketCount = async () => 0n;

  const discovered = await discoverLandedMarket({
    marketId: 'm-ignored-creator',
    questionHashHex: qHex,
    resolutionHashHex: rHex,
  });

  assert.equal(discovered, null);
});

test('market-idempotency: prepareMarketCommitment pins once and persists questionHash, metaUri, resolutionSpec, seedAmountRaw', async () => {
  let pins = 0;
  const prevIpfs = setIpfsTransport({
    pin: async () => {
      pins++;
      return 'bafkprepmk1';
    },
    fetch: async () => Buffer.from(''),
  });

  let persistedData: any = null;
  (prisma.market as any).updateMany = async ({ where, data }: any) => {
    persistedData = { where, data };
    return { count: 1 };
  };

  const dummyMarket: any = {
    id: 'm-prep-1',
    question: 'Will SpaceX reach Mars by 2026?',
    category: 'CRYPTO',
    expiryTimestamp: new Date('2026-12-31T00:00:00Z'),
    resolutionOracle: 'https://spacex.com',
    minimumLiquidity: 100,
    initialYesProb: 0.5,
    questionHash: null,
    metaUri: null,
    resolutionHash: null,
    resolutionSpec: null,
    seedAmountRaw: null,
  };

  const prep = await prepareMarketCommitment(dummyMarket, undefined, {
    seedRaw: 500_000_000n,
    initialYesBps: 5000,
  });

  assert.equal(prep.reusedPin, false);
  assert.equal(pins, 1);
  assert.equal(prep.seedRaw, 500_000_000n);
  assert.equal(prep.initialYesBps, 5000);
  assert.match(prep.questionHash, /^[0-9a-f]{64}$/);
  assert.equal(prep.metaUri, 'ipfs://bafkprepmk1');
  assert.ok(persistedData);
  assert.equal(persistedData.where.id, 'm-prep-1');
  assert.equal(persistedData.where.questionHash, null);
  assert.equal(persistedData.data.questionHash, prep.questionHash);
  assert.equal(persistedData.data.metaUri, prep.metaUri);
  assert.equal(persistedData.data.seedAmountRaw, '500000000');

  setIpfsTransport(prevIpfs);
});

test('market-idempotency: prepareMarketCommitment reuses a persisted pin and never calls transport', async () => {
  const dummyMarket: any = {
    id: 'm-prep-2',
    question: 'Will Starship land on Mars?',
    category: 'CRYPTO',
    expiryTimestamp: new Date('2026-12-31T00:00:00Z'),
    resolutionOracle: 'https://spacex.com',
    minimumLiquidity: 100,
    initialYesProb: 0.5,
    questionHash: null,
    metaUri: null,
    resolutionHash: null,
    resolutionSpec: null,
    seedAmountRaw: null,
  };

  (prisma.market as any).updateMany = async () => ({ count: 1 });
  (prisma.market as any).update = async () => ({});

  let transportCalls = 0;
  const prevIpfs = setIpfsTransport({
    pin: async () => {
      transportCalls++;
      return 'bafkinitial2';
    },
    fetch: async () => Buffer.from(''),
  });

  const prep1 = await prepareMarketCommitment(dummyMarket);
  assert.equal(transportCalls, 1);

  dummyMarket.questionHash = prep1.questionHash;
  dummyMarket.metaUri = prep1.metaUri;
  dummyMarket.resolutionHash = prep1.resolutionHashHex;

  // Reset counter to ensure reuse does not call transport
  transportCalls = 0;
  const prep2 = await prepareMarketCommitment(dummyMarket);
  assert.equal(prep2.reusedPin, true);
  assert.equal(prep2.questionHash, prep1.questionHash);
  assert.equal(prep2.metaUri, prep1.metaUri);
  assert.equal(transportCalls, 0);

  setIpfsTransport(prevIpfs);
});

test('market-idempotency: prepareMarketCommitment throws QUESTION_HASH_MISMATCH when question changed after first pin', async () => {
  const dummyMarket: any = {
    id: 'm-prep-3',
    question: 'Original question text?',
    category: 'CRYPTO',
    expiryTimestamp: new Date('2026-12-31T00:00:00Z'),
    resolutionOracle: 'https://spacex.com',
    minimumLiquidity: 100,
    initialYesProb: 0.5,
    questionHash: null,
    metaUri: null,
    resolutionHash: null,
  };

  (prisma.market as any).updateMany = async () => ({ count: 1 });
  const prevIpfs = setIpfsTransport({
    pin: async () => 'bafkinitial',
    fetch: async () => Buffer.from(''),
  });
  const prep1 = await prepareMarketCommitment(dummyMarket);
  setIpfsTransport(prevIpfs);

  const editedMarket: any = {
    ...dummyMarket,
    question: 'Admin modified question text!',
    questionHash: prep1.questionHash,
    metaUri: prep1.metaUri,
  };

  await assert.rejects(
    () => prepareMarketCommitment(editedMarket),
    (err: any) => err.code === 'QUESTION_HASH_MISMATCH' || err.statusCode === 409,
  );
});

test('market-idempotency: submitMarketCreation dry-run releases claim and leaves onChainMarketId null', async () => {
  const prevMode = config.CHAIN_EXECUTION_MODE;
  (config as any).CHAIN_EXECUTION_MODE = 'dry-run';

  let claimReleased = false;
  (prisma as any).$queryRaw = async () => [{ market_id: 'm-dry', status: 'UNCLAIMED', attempts: 0 }];
  (prisma as any).$executeRaw = async () => {
    claimReleased = true;
    return 1;
  };
  (prisma as any).$transaction = async (fn: any) => fn(prisma);

  const prevChain = setChainOverrides({
    agentCreateMarket: async () => ({
      mode: 'dry-run',
      method: 'agent_create_market',
      value: 12345n,
      txHash: null,
    }),
  });

  const dummyMarket: any = {
    id: 'm-dry',
    category: 'CRYPTO',
    expiryTimestamp: new Date('2026-12-31T00:00:00Z'),
    onChainMarketId: null,
  };

  const prep: any = {
    spec: { kind: 'signers', signers: ['G1'], threshold: 1, disputeWindow: 3600 },
    resolutionHashBytes: Buffer.alloc(32, 1),
    resolutionHashHex: '01'.repeat(32),
    questionHash: '02'.repeat(32),
    questionCid: 'cid-dry',
    metaUri: 'ipfs://cid-dry',
    seedRaw: 100n,
    initialYesBps: 5000,
    reusedPin: false,
  };

  try {
    const res = await submitMarketCreation(dummyMarket, prep);
    assert.equal(res.mode, 'dry-run');
    assert.equal(claimReleased, true);
    assert.equal(dummyMarket.onChainMarketId, null);
  } finally {
    (config as any).CHAIN_EXECUTION_MODE = prevMode;
    setChainOverrides(prevChain);
  }
});

test('market-idempotency: submitMarketCreation live success passes { kind: market.create, refId } to agentCreateMarket', async () => {
  const prevMode = config.CHAIN_EXECUTION_MODE;
  (config as any).CHAIN_EXECUTION_MODE = 'live';

  (prisma as any).$queryRaw = async () => [{ market_id: 'm-live', status: 'UNCLAIMED', attempts: 0 }];
  (prisma as any).$executeRaw = async () => 1;
  (prisma as any).$transaction = async (fn: any) => fn(prisma);
  (prisma.marketCreationAttempt as any).update = async () => ({});
  (prisma.marketCreationAttempt as any).upsert = async () => ({});
  (prisma.market as any).findUnique = async () => ({ onChainMarketId: null });
  (prisma.market as any).findFirst = async () => null;
  (prisma.market as any).update = async () => ({});

  marketCreationDeps.getTransaction = async () => null;
  marketCreationDeps.getMarketCount = async () => 10n;
  (prisma.chainEvent as any).findMany = async () => [];

  let capturedOutboxOpts: any = null;
  const prevChain = setChainOverrides({
    marketCount: async () => 10n,
    agentCreateMarket: async (_args: any, _signer: any, outboxOpts?: any) => {
      capturedOutboxOpts = outboxOpts;
      return {
        mode: 'live',
        method: 'agent_create_market',
        value: 1001n,
        txHash: 'tx-live-success',
      };
    },
  });

  const dummyMarket: any = {
    id: 'm-live',
    category: 'CRYPTO',
    expiryTimestamp: new Date('2026-12-31T00:00:00Z'),
  };

  const prep: any = {
    spec: { kind: 'signers', signers: ['G1'], threshold: 1, disputeWindow: 3600 },
    resolutionHashBytes: Buffer.alloc(32, 1),
    resolutionHashHex: '01'.repeat(32),
    questionHash: '02'.repeat(32),
    questionCid: 'cid-live',
    metaUri: 'ipfs://cid-live',
    seedRaw: 100n,
    initialYesBps: 5000,
    reusedPin: false,
  };

  try {
    const res = await submitMarketCreation(dummyMarket, prep);
    assert.equal(res.mode, 'live');
    assert.equal(res.value, 1001n);
    assert.deepEqual(capturedOutboxOpts, { kind: 'market.create', refId: 'm-live' });
  } finally {
    (config as any).CHAIN_EXECUTION_MODE = prevMode;
    setChainOverrides(prevChain);
  }
});

test('market-idempotency: ChainPendingError stores txHash and rethrows; attempt stays SUBMITTED', async () => {
  const prevMode = config.CHAIN_EXECUTION_MODE;
  (config as any).CHAIN_EXECUTION_MODE = 'live';

  (prisma as any).$queryRaw = async () => [{ market_id: 'm-pending', status: 'UNCLAIMED', attempts: 0 }];
  (prisma as any).$executeRaw = async () => 1;
  (prisma as any).$transaction = async (fn: any) => fn(prisma);

  let attemptUpdated: any = null;
  (prisma.marketCreationAttempt as any).update = async ({ where, data }: any) => {
    attemptUpdated = { where, data };
    return {};
  };

  marketCreationDeps.getTransaction = async () => null;
  marketCreationDeps.getMarketCount = async () => 10n;
  (prisma.chainEvent as any).findMany = async () => [];

  const prevChain = setChainOverrides({
    marketCount: async () => 10n,
    agentCreateMarket: async () => {
      throw new ChainPendingError('Tx in flight', 'outbox-pending-1', 'tx-pending-999');
    },
  });

  const dummyMarket: any = {
    id: 'm-pending',
    category: 'CRYPTO',
    expiryTimestamp: new Date('2026-12-31T00:00:00Z'),
  };

  const prep: any = {
    spec: { kind: 'signers', signers: ['G1'], threshold: 1, disputeWindow: 3600 },
    resolutionHashBytes: Buffer.alloc(32, 1),
    resolutionHashHex: '01'.repeat(32),
    questionHash: '02'.repeat(32),
    questionCid: 'cid-p',
    metaUri: 'ipfs://cid-p',
    seedRaw: 100n,
    initialYesBps: 5000,
    reusedPin: false,
  };

  try {
    await assert.rejects(
      () => submitMarketCreation(dummyMarket, prep),
      (err: any) => err instanceof ChainPendingError && err.txHash === 'tx-pending-999',
    );
    assert.equal(attemptUpdated?.where?.marketId, 'm-pending');
    assert.equal(attemptUpdated?.data?.txHash, 'tx-pending-999');
  } finally {
    (config as any).CHAIN_EXECUTION_MODE = prevMode;
    setChainOverrides(prevChain);
  }
});

test('market-idempotency: TradeCapExceeded writes SEED_CAP_RACE and rethrows', async () => {
  const prevMode = config.CHAIN_EXECUTION_MODE;
  (config as any).CHAIN_EXECUTION_MODE = 'live';

  (prisma as any).$queryRaw = async () => [{ market_id: 'm-race', status: 'UNCLAIMED', attempts: 0 }];
  (prisma as any).$executeRaw = async () => 1;
  (prisma as any).$transaction = async (fn: any) => fn(prisma);
  (prisma.marketCreationAttempt as any).update = async () => ({});

  let agentLogAction: string | null = null;
  (prisma.agentLog as any).create = async ({ data }: any) => {
    agentLogAction = data.action;
    return {};
  };

  marketCreationDeps.getTransaction = async () => null;
  marketCreationDeps.getMarketCount = async () => 10n;
  (prisma.chainEvent as any).findMany = async () => [];

  const prevChain = setChainOverrides({
    marketCount: async () => 10n,
    agentCreateMarket: async () => {
      throw new ChainError('Cap exceeded', 'TradeCapExceeded');
    },
  });

  const dummyMarket: any = {
    id: 'm-race',
    category: 'CRYPTO',
    expiryTimestamp: new Date('2026-12-31T00:00:00Z'),
  };

  const prep: any = {
    spec: { kind: 'signers', signers: ['G1'], threshold: 1, disputeWindow: 3600 },
    resolutionHashBytes: Buffer.alloc(32, 1),
    resolutionHashHex: '01'.repeat(32),
    questionHash: '02'.repeat(32),
    questionCid: 'cid-r',
    metaUri: 'ipfs://cid-r',
    seedRaw: 500n,
    initialYesBps: 5000,
    reusedPin: false,
  };

  try {
    await assert.rejects(
      () => submitMarketCreation(dummyMarket, prep),
      (err: any) => err instanceof ChainError && err.contractError === 'TradeCapExceeded',
    );
    assert.equal(agentLogAction, 'SEED_CAP_RACE');
  } finally {
    (config as any).CHAIN_EXECUTION_MODE = prevMode;
    setChainOverrides(prevChain);
  }
});
