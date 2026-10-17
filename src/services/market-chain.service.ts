/**
 * Puts a database market on-chain through treasury.agent_create_market.
 *
 * ADR 0001: the market commits to its resolution rule at creation. We build
 * the spec, hash it exactly like scripts/spec-hash in the contracts repo,
 * store the full spec next to the market (so anyone can reveal it to
 * resolver.register_signer_spec later) and pass the hash on-chain.
 */
import type { Market } from '@prisma/client';
import { config } from '../config';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { toContractCategory, toContractCategoryValue } from '../lib/categories';
import { USDC_UNIT, usdcFromNumber } from '../lib/amounts';
import { resolutionHash, type ResolutionSpecJson } from '../lib/resolution-spec';
import { agentCreateMarket, type WriteResult } from './chain.service';
import { agentSigner } from './stellar/clients';
import { pinDocument } from './ipfs.service';
import {
  questionDocument as buildQuestionDoc,
  QuestionDocV1,
  QuestionDocV2,
} from '../schemas/question';

/** market-core MIN_SEED is 100 USDC. */
export const MIN_SEED_RAW = 100n * USDC_UNIT;

export function defaultResolutionSpec(): ResolutionSpecJson {
  const signers =
    config.RESOLUTION_SIGNERS.length > 0
      ? config.RESOLUTION_SIGNERS
      : [agentSigner().publicKey as string];
  return {
    kind: 'signers',
    signers,
    threshold: config.RESOLUTION_THRESHOLD,
    disputeWindow: config.RESOLUTION_DISPUTE_WINDOW_SECS,
  };
}

/** The question document pinned to IPFS; its sha256 is the on-chain question_hash. */
export function questionDocument(
  market: Market,
  resolutionHashHex: string,
  version: 1 | 2 = (config.QUESTION_DOC_VERSION as 1 | 2) || 2,
) {
  return buildQuestionDoc(
    {
      id: market.id,
      question: market.question,
      category: market.category,
      expiryTimestamp: market.expiryTimestamp,
    },
    {
      specHash: resolutionHashHex,
      source: market.resolutionOracle,
    },
    toContractCategory(market.category),
    version,
  );
}

export function initialYesBps(probability: number): number {
  return Math.min(9900, Math.max(100, Math.round(probability * 10_000)));
}

export interface PreparedMarketCommitment {
  spec: ResolutionSpecJson;
  resolutionHashBytes: Buffer;
  resolutionHashHex: string;
  questionCid: string;
  questionHash: string;
  metaUri: string;
  seedAmountRaw: bigint;
}

/**
 * Prepares resolution spec, pins the question document to IPFS, and updates the database row.
 * Idempotent: re-calling on a market with questionHash already set will not re-pin.
 */
export async function prepareMarketCommitment(
  market: Market,
  spec: ResolutionSpecJson = defaultResolutionSpec(),
): Promise<PreparedMarketCommitment> {
  const resolutionHashBytes = resolutionHash(spec);
  const resolutionHashHex = resolutionHashBytes.toString('hex');

  let questionHash = market.questionHash;
  let metaUri = market.metaUri;
  let questionCid = metaUri ? metaUri.replace(/^ipfs:\/\//, '') : '';

  if (!questionHash || !metaUri) {
    const doc = questionDocument(market, resolutionHashHex);
    const pinned =
      config.QUESTION_DOC_VERSION === 1
        ? await pinDocument(QuestionDocV1, doc as any, `oracledesk-market-${market.id}`)
        : await pinDocument(QuestionDocV2, doc as any, `oracledesk-market-${market.id}`);

    questionHash = pinned.hash;
    questionCid = pinned.cid;
    metaUri = `ipfs://${pinned.cid}`;
  }

  const requested = usdcFromNumber(market.minimumLiquidity);
  const seed = requested < MIN_SEED_RAW ? MIN_SEED_RAW : requested;

  await prisma.market.update({
    where: { id: market.id },
    data: {
      resolutionSpec: spec as object,
      resolutionHash: resolutionHashHex,
      questionHash,
      metaUri,
      seedAmountRaw: seed.toString(),
    },
  });

  return {
    spec,
    resolutionHashBytes,
    resolutionHashHex,
    questionCid,
    questionHash,
    metaUri,
    seedAmountRaw: seed,
  };
}

/**
 * Submits the market creation transaction to the chain (or simulates in dry-run).
 */
export async function submitMarketCreation(
  market: Market,
  prepared?: PreparedMarketCommitment,
): Promise<WriteResult<bigint>> {
  const prep = prepared ?? (await prepareMarketCommitment(market));

  const result = await agentCreateMarket({
    question_hash: Buffer.from(prep.questionHash, 'hex'),
    resolution_hash: prep.resolutionHashBytes,
    meta_uri: prep.metaUri,
    category: toContractCategoryValue(market.category),
    close_time: BigInt(Math.floor(market.expiryTimestamp.getTime() / 1000)),
    seed_amount: prep.seedAmountRaw,
    initial_yes_bps: initialYesBps(market.initialYesProb),
  });

  if (result.mode === 'live') {
    await prisma.market.update({
      where: { id: market.id },
      data: { onChainMarketId: result.value, creationTxHash: result.txHash, status: 'ACTIVE' },
    });
    logger.info({ marketId: market.id, onChainMarketId: result.value.toString() }, 'Market created on-chain');
  } else {
    logger.info(
      { marketId: market.id, simulatedMarketId: result.value.toString() },
      'Market creation simulated (dry-run); market stays PENDING',
    );
  }
  return result;
}

export async function createMarketOnChain(
  market: Market,
  spec: ResolutionSpecJson = defaultResolutionSpec(),
): Promise<WriteResult<bigint>> {
  const prep = await prepareMarketCommitment(market, spec);
  return submitMarketCreation(market, prep);
}
