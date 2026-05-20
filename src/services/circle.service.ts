import axios from 'axios';
import crypto from 'crypto';
import { config } from '../config';
import { logger } from '../lib/logger';
import { AppError } from '../middlewares/error.middleware';

type CirclePublicKey = {
  id: string;
  algorithm: string;
  publicKey: string;
};

type CircleTransaction = {
  id?: string;
  state?: string;
  status?: string;
  txHash?: string;
  transactionHash?: string;
  amounts?: string[];
  amount?: string;
  amountInUSD?: string;
  contractAddress?: string;
  sourceAddress?: string;
  destinationAddress?: string;
  walletAddress?: string;
};

const publicKeyCache = new Map<string, CirclePublicKey>();

export async function verifyCircleWebhookSignature(params: {
  rawBody: Buffer;
  signature?: string;
  keyId?: string;
}): Promise<boolean> {
  const { rawBody, signature, keyId } = params;

  if (!signature || !keyId) return false;

  const publicKey = await getCirclePublicKey(keyId);
  if (publicKey.algorithm !== 'ECDSA_SHA_256') {
    throw new AppError(400, 'UNSUPPORTED_CIRCLE_SIGNATURE_ALGORITHM', `Unsupported Circle signature algorithm ${publicKey.algorithm}`);
  }

  const derKey = Buffer.from(publicKey.publicKey, 'base64');
  const keyObject = crypto.createPublicKey({ key: derKey, format: 'der', type: 'spki' });
  return crypto.verify('sha256', rawBody, keyObject, Buffer.from(signature, 'base64'));
}

export async function getCirclePublicKey(keyId: string): Promise<CirclePublicKey> {
  const cached = publicKeyCache.get(keyId);
  if (cached) return cached;

  if (!config.CIRCLE_API_KEY) {
    throw new AppError(500, 'CIRCLE_API_KEY_MISSING', 'CIRCLE_API_KEY is required to verify Circle webhooks');
  }

  const { data } = await axios.get<{ data: CirclePublicKey }>(
    `${config.CIRCLE_BASE_URL}/v2/notifications/publicKey/${keyId}`,
    {
      headers: { Authorization: `Bearer ${config.CIRCLE_API_KEY}` },
      timeout: 10_000,
    },
  );

  publicKeyCache.set(keyId, data.data);
  return data.data;
}

export async function findCircleTransactionByHash(txHash: string): Promise<CircleTransaction | null> {
  if (!config.CIRCLE_API_KEY) {
    if (config.CIRCLE_STRICT_PAYMENT_VERIFICATION) {
      throw new AppError(500, 'CIRCLE_API_KEY_MISSING', 'CIRCLE_API_KEY is required for strict payment verification');
    }
    return null;
  }

  const { data } = await axios.get<{ data: { transactions: CircleTransaction[] } }>(
    `${config.CIRCLE_BASE_URL}/v1/w3s/transactions`,
    {
      headers: { Authorization: `Bearer ${config.CIRCLE_API_KEY}` },
      params: { txHash },
      timeout: 10_000,
    },
  );

  return (data.data.transactions ?? []).find(tx =>
    tx.txHash?.toLowerCase() === txHash.toLowerCase() ||
    tx.transactionHash?.toLowerCase() === txHash.toLowerCase(),
  ) ?? null;
}

export async function createCircleContractExecution(params: {
  contractAddress: string;
  abiFunctionSignature: string;
  abiParameters: Array<string | number | boolean>;
  refId: string;
}): Promise<{ transactionId: string }> {
  if (!config.CIRCLE_API_KEY || !config.CIRCLE_ENTITY_SECRET) {
    throw new AppError(500, 'CIRCLE_CONFIG_MISSING', 'CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET are required for Circle execution');
  }

  if (!config.CIRCLE_WALLET_ID && !config.CIRCLE_WALLET_ADDRESS) {
    throw new AppError(500, 'CIRCLE_WALLET_MISSING', 'CIRCLE_WALLET_ID or CIRCLE_WALLET_ADDRESS is required for Circle execution');
  }

  const body: Record<string, unknown> = {
    idempotencyKey: crypto.randomUUID(),
    contractAddress: params.contractAddress,
    entitySecretCiphertext: config.CIRCLE_ENTITY_SECRET,
    abiFunctionSignature: params.abiFunctionSignature,
    abiParameters: params.abiParameters,
    feeLevel: 'MEDIUM',
    refId: params.refId,
  };

  if (config.CIRCLE_WALLET_ID) {
    body.walletId = config.CIRCLE_WALLET_ID;
  } else {
    body.walletAddress = config.CIRCLE_WALLET_ADDRESS;
    body.blockchain = config.CIRCLE_BLOCKCHAIN;
  }

  const { data } = await axios.post<{ data: { id: string } }>(
    `${config.CIRCLE_BASE_URL}/v1/w3s/developer/transactions/contractExecution`,
    body,
    {
      headers: {
        Authorization: `Bearer ${config.CIRCLE_API_KEY}`,
        'Content-Type': 'application/json',
        'X-Request-Id': crypto.randomUUID(),
      },
      timeout: 20_000,
    },
  );

  logger.info({ transactionId: data.data.id, refId: params.refId }, 'Circle contract execution submitted');
  return { transactionId: data.data.id };
}

export function extractCircleTransaction(notification: unknown): CircleTransaction | null {
  if (!notification || typeof notification !== 'object') return null;
  const obj = notification as Record<string, any>;
  if (obj.txHash || obj.transactionHash || obj.amounts) return obj as CircleTransaction;
  if (obj.transaction) return obj.transaction as CircleTransaction;
  if (obj.transactions?.[0]) return obj.transactions[0] as CircleTransaction;
  return null;
}
