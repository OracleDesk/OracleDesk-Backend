"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyCircleWebhookSignature = verifyCircleWebhookSignature;
exports.getCirclePublicKey = getCirclePublicKey;
exports.findCircleTransactionByHash = findCircleTransactionByHash;
exports.createCircleContractExecution = createCircleContractExecution;
exports.extractCircleTransaction = extractCircleTransaction;
const axios_1 = __importDefault(require("axios"));
const crypto_1 = __importDefault(require("crypto"));
const config_1 = require("../config");
const logger_1 = require("../lib/logger");
const error_middleware_1 = require("../middlewares/error.middleware");
const publicKeyCache = new Map();
async function verifyCircleWebhookSignature(params) {
    const { rawBody, signature, keyId } = params;
    if (!signature || !keyId)
        return false;
    const publicKey = await getCirclePublicKey(keyId);
    if (publicKey.algorithm !== 'ECDSA_SHA_256') {
        throw new error_middleware_1.AppError(400, 'UNSUPPORTED_CIRCLE_SIGNATURE_ALGORITHM', `Unsupported Circle signature algorithm ${publicKey.algorithm}`);
    }
    const derKey = Buffer.from(publicKey.publicKey, 'base64');
    const keyObject = crypto_1.default.createPublicKey({ key: derKey, format: 'der', type: 'spki' });
    return crypto_1.default.verify('sha256', rawBody, keyObject, Buffer.from(signature, 'base64'));
}
async function getCirclePublicKey(keyId) {
    const cached = publicKeyCache.get(keyId);
    if (cached)
        return cached;
    if (!config_1.config.CIRCLE_API_KEY) {
        throw new error_middleware_1.AppError(500, 'CIRCLE_API_KEY_MISSING', 'CIRCLE_API_KEY is required to verify Circle webhooks');
    }
    const { data } = await axios_1.default.get(`${config_1.config.CIRCLE_BASE_URL}/v2/notifications/publicKey/${keyId}`, {
        headers: { Authorization: `Bearer ${config_1.config.CIRCLE_API_KEY}` },
        timeout: 10000,
    });
    publicKeyCache.set(keyId, data.data);
    return data.data;
}
async function findCircleTransactionByHash(txHash) {
    if (!config_1.config.CIRCLE_API_KEY) {
        if (config_1.config.CIRCLE_STRICT_PAYMENT_VERIFICATION) {
            throw new error_middleware_1.AppError(500, 'CIRCLE_API_KEY_MISSING', 'CIRCLE_API_KEY is required for strict payment verification');
        }
        return null;
    }
    const { data } = await axios_1.default.get(`${config_1.config.CIRCLE_BASE_URL}/v1/w3s/transactions`, {
        headers: { Authorization: `Bearer ${config_1.config.CIRCLE_API_KEY}` },
        params: { txHash },
        timeout: 10000,
    });
    return (data.data.transactions ?? []).find(tx => tx.txHash?.toLowerCase() === txHash.toLowerCase() ||
        tx.transactionHash?.toLowerCase() === txHash.toLowerCase()) ?? null;
}
async function createCircleContractExecution(params) {
    if (!config_1.config.CIRCLE_API_KEY || !config_1.config.CIRCLE_ENTITY_SECRET) {
        throw new error_middleware_1.AppError(500, 'CIRCLE_CONFIG_MISSING', 'CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET are required for Circle execution');
    }
    if (!config_1.config.CIRCLE_WALLET_ID && !config_1.config.CIRCLE_WALLET_ADDRESS) {
        throw new error_middleware_1.AppError(500, 'CIRCLE_WALLET_MISSING', 'CIRCLE_WALLET_ID or CIRCLE_WALLET_ADDRESS is required for Circle execution');
    }
    const body = {
        idempotencyKey: crypto_1.default.randomUUID(),
        contractAddress: params.contractAddress,
        entitySecretCiphertext: config_1.config.CIRCLE_ENTITY_SECRET,
        abiFunctionSignature: params.abiFunctionSignature,
        abiParameters: params.abiParameters,
        feeLevel: 'MEDIUM',
        refId: params.refId,
    };
    if (config_1.config.CIRCLE_WALLET_ID) {
        body.walletId = config_1.config.CIRCLE_WALLET_ID;
    }
    else {
        body.walletAddress = config_1.config.CIRCLE_WALLET_ADDRESS;
        body.blockchain = config_1.config.CIRCLE_BLOCKCHAIN;
    }
    const { data } = await axios_1.default.post(`${config_1.config.CIRCLE_BASE_URL}/v1/w3s/developer/transactions/contractExecution`, body, {
        headers: {
            Authorization: `Bearer ${config_1.config.CIRCLE_API_KEY}`,
            'Content-Type': 'application/json',
            'X-Request-Id': crypto_1.default.randomUUID(),
        },
        timeout: 20000,
    });
    logger_1.logger.info({ transactionId: data.data.id, refId: params.refId }, 'Circle contract execution submitted');
    return { transactionId: data.data.id };
}
function extractCircleTransaction(notification) {
    if (!notification || typeof notification !== 'object')
        return null;
    const obj = notification;
    if (obj.txHash || obj.transactionHash || obj.amounts)
        return obj;
    if (obj.transaction)
        return obj.transaction;
    if (obj.transactions?.[0])
        return obj.transactions[0];
    return null;
}
