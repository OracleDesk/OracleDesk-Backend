import { ethers } from 'ethers';
import axios from 'axios';
import { config } from '../config';
import { logger } from '../lib/logger';
import { AppError } from '../middlewares/error.middleware';

// ── Polymarket CLOB Config ────────────────────────────────────────────────────
const CTF_EXCHANGE = '0xE111180000d2663C0091e4f400237545B87B996B';
const POLYMARKET_CLOB_URL = 'https://clob.polymarket.com';

const DOMAIN = {
  name:              'CTF Exchange',
  version:           '1',
  chainId:           137,          // Polygon mainnet
  verifyingContract: CTF_EXCHANGE,
};

const ORDER_TYPES = {
  Order: [
    { name: 'salt',          type: 'uint256' },
    { name: 'maker',         type: 'address' },
    { name: 'signer',        type: 'address' },
    { name: 'taker',         type: 'address' },
    { name: 'tokenId',       type: 'uint256' },
    { name: 'makerAmount',   type: 'uint256' },
    { name: 'takerAmount',   type: 'uint256' },
    { name: 'expiration',    type: 'uint256' },
    { name: 'nonce',         type: 'uint256' },
    { name: 'feeRateBps',    type: 'uint256' },
    { name: 'side',          type: 'uint8'   },
    { name: 'signatureType', type: 'uint8'   },
  ],
};

export interface PolymarketOrderParams {
  tokenId:      string;   // CTF token ID from Polymarket API
  usdcAmount:   number;   // USDC to spend (whole units)
  price:        number;   // share price (0.0–1.0)
  side:         'BUY' | 'SELL';
  expiryHours?: number;
}

/**
 * Signs and submits an order to the Polymarket CLOB.
 */
export async function submitPolymarketOrder(params: PolymarketOrderParams): Promise<string> {
  if (!config.POLYGON_PRIVATE_KEY) {
    throw new AppError(500, 'POLYGON_PRIVATE_KEY_MISSING', 'Polygon private key is required for Polymarket execution');
  }

  const signer = new ethers.Wallet(config.POLYGON_PRIVATE_KEY);
  
  // 1. Build the order
  const makerAmount = BigInt(Math.round(params.usdcAmount * 1e6));
  const takerAmount = BigInt(Math.round((params.usdcAmount / params.price) * 1e6));
  const expiration  = BigInt(
    Math.floor(Date.now() / 1000) + (params.expiryHours ?? 1) * 3600
  );

  const order = {
    salt:          BigInt(Math.floor(Math.random() * 1e15)),
    maker:         signer.address,
    signer:        signer.address,
    taker:         ethers.ZeroAddress,
    tokenId:       BigInt(params.tokenId),
    makerAmount,
    takerAmount,
    expiration,
    nonce:         0n,
    feeRateBps:    0n,
    side:          params.side === 'BUY' ? 0 : 1,
    signatureType: 0, // EOA
  };

  // 2. Sign the order
  const signature = await signer.signTypedData(DOMAIN, ORDER_TYPES, order);

  // 3. Format for API
  const apiPayload = {
    order: {
      salt:          order.salt.toString(),
      maker:         order.maker,
      signer:        order.signer,
      taker:         order.taker,
      tokenId:       order.tokenId.toString(),
      makerAmount:   order.makerAmount.toString(),
      takerAmount:   order.takerAmount.toString(),
      expiration:    order.expiration.toString(),
      nonce:         order.nonce.toString(),
      feeRateBps:    order.feeRateBps.toString(),
      side:          order.side,
      signatureType: order.signatureType,
    },
    signature,
    orderType: 'GTC',
  };

  // 4. POST to Polymarket CLOB
  if (config.CHAIN_EXECUTION_MODE === 'mock') {
    logger.info({ apiPayload }, 'Mock: Polymarket order signed');
    return `mock-poly-tx-${Date.now()}`;
  }

  try {
    const response = await axios.post(`${POLYMARKET_CLOB_URL}/order?builderCode=${config.POLYMARKET_BUILDER_CODE}`, apiPayload);
    logger.info({ orderId: response.data.orderID }, 'Polymarket order submitted successfully');
    return response.data.orderID;
  } catch (err: any) {
    logger.error({ 
      error: err.response?.data ?? err.message,
      payload: apiPayload 
    }, 'Failed to submit Polymarket order');
    throw new AppError(502, 'POLYMARKET_SUBMISSION_FAILED', 'Failed to submit order to Polymarket CLOB', err.response?.data);
  }
}
