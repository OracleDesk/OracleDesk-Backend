"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.submitPolymarketOrder = submitPolymarketOrder;
const ethers_1 = require("ethers");
const axios_1 = __importDefault(require("axios"));
const config_1 = require("../config");
const logger_1 = require("../lib/logger");
const error_middleware_1 = require("../middlewares/error.middleware");
// ── Polymarket CLOB Config ────────────────────────────────────────────────────
const CTF_EXCHANGE = '0xE111180000d2663C0091e4f400237545B87B996B';
const POLYMARKET_CLOB_URL = 'https://clob.polymarket.com';
const DOMAIN = {
    name: 'CTF Exchange',
    version: '1',
    chainId: 137, // Polygon mainnet
    verifyingContract: CTF_EXCHANGE,
};
const ORDER_TYPES = {
    Order: [
        { name: 'salt', type: 'uint256' },
        { name: 'maker', type: 'address' },
        { name: 'signer', type: 'address' },
        { name: 'taker', type: 'address' },
        { name: 'tokenId', type: 'uint256' },
        { name: 'makerAmount', type: 'uint256' },
        { name: 'takerAmount', type: 'uint256' },
        { name: 'expiration', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'feeRateBps', type: 'uint256' },
        { name: 'side', type: 'uint8' },
        { name: 'signatureType', type: 'uint8' },
    ],
};
/**
 * Signs and submits an order to the Polymarket CLOB.
 */
async function submitPolymarketOrder(params) {
    if (!config_1.config.POLYGON_PRIVATE_KEY) {
        throw new error_middleware_1.AppError(500, 'POLYGON_PRIVATE_KEY_MISSING', 'Polygon private key is required for Polymarket execution');
    }
    const signer = new ethers_1.ethers.Wallet(config_1.config.POLYGON_PRIVATE_KEY);
    // 1. Build the order
    const makerAmount = BigInt(Math.round(params.usdcAmount * 1e6));
    const takerAmount = BigInt(Math.round((params.usdcAmount / params.price) * 1e6));
    const expiration = BigInt(Math.floor(Date.now() / 1000) + (params.expiryHours ?? 1) * 3600);
    const order = {
        salt: BigInt(Math.floor(Math.random() * 1e15)),
        maker: signer.address,
        signer: signer.address,
        taker: ethers_1.ethers.ZeroAddress,
        tokenId: BigInt(params.tokenId),
        makerAmount,
        takerAmount,
        expiration,
        nonce: 0n,
        feeRateBps: 0n,
        side: params.side === 'BUY' ? 0 : 1,
        signatureType: 0, // EOA
    };
    // 2. Sign the order
    const signature = await signer.signTypedData(DOMAIN, ORDER_TYPES, order);
    // 3. Format for API
    const apiPayload = {
        order: {
            salt: order.salt.toString(),
            maker: order.maker,
            signer: order.signer,
            taker: order.taker,
            tokenId: order.tokenId.toString(),
            makerAmount: order.makerAmount.toString(),
            takerAmount: order.takerAmount.toString(),
            expiration: order.expiration.toString(),
            nonce: order.nonce.toString(),
            feeRateBps: order.feeRateBps.toString(),
            side: order.side,
            signatureType: order.signatureType,
        },
        signature,
        orderType: 'GTC',
    };
    // 4. POST to Polymarket CLOB
    if (config_1.config.CHAIN_EXECUTION_MODE === 'mock') {
        logger_1.logger.info({ apiPayload }, 'Mock: Polymarket order signed');
        return `mock-poly-tx-${Date.now()}`;
    }
    try {
        const response = await axios_1.default.post(`${POLYMARKET_CLOB_URL}/order?builderCode=${config_1.config.POLYMARKET_BUILDER_CODE}`, apiPayload);
        logger_1.logger.info({ orderId: response.data.orderID }, 'Polymarket order submitted successfully');
        return response.data.orderID;
    }
    catch (err) {
        logger_1.logger.error({
            error: err.response?.data ?? err.message,
            payload: apiPayload
        }, 'Failed to submit Polymarket order');
        throw new error_middleware_1.AppError(502, 'POLYMARKET_SUBMISSION_FAILED', 'Failed to submit order to Polymarket CLOB', err.response?.data);
    }
}
