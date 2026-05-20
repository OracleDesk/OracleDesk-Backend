"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadTraceToIPFS = uploadTraceToIPFS;
exports.retrieveTrace = retrieveTrace;
exports.verifyCID = verifyCID;
exports.listPins = listPins;
const axios_1 = __importDefault(require("axios"));
const prisma_1 = require("../lib/prisma");
const logger_1 = require("../lib/logger");
const config_1 = require("../config");
const hash_util_1 = require("../utils/hash.util");
const error_middleware_1 = require("../middlewares/error.middleware");
const PINATA_BASE = 'https://api.pinata.cloud';
const IPFS_GATEWAY = 'https://gateway.pinata.cloud/ipfs';
const pinataHeaders = () => ({
    pinata_api_key: config_1.config.PINATA_API_KEY,
    pinata_secret_api_key: config_1.config.PINATA_SECRET_API_KEY,
    'Content-Type': 'application/json',
});
/**
 * Pins a reasoning trace JSON object to IPFS via Pinata.
 *
 * Returns the CID (Content Identifier) — a hash of the content itself.
 * The same content always produces the same CID (content-addressing).
 *
 * Retries once on network errors before failing.
 */
async function uploadTraceToIPFS(tracePayload, traceId) {
    const sha256Hash = (0, hash_util_1.sha256Json)(tracePayload);
    let cid;
    try {
        cid = await pinWithRetry(tracePayload, traceId);
    }
    catch (err) {
        logger_1.logger.error({ err, traceId }, 'IPFS upload failed after retry');
        throw new error_middleware_1.AppError(502, 'IPFS_UPLOAD_FAILED', 'Failed to pin trace to IPFS', { traceId });
    }
    // Persist CID and hash to the trace record
    await prisma_1.prisma.reasoningTrace.update({
        where: { id: traceId },
        data: { ipfsCid: cid, sha256Hash },
    });
    logger_1.logger.info({ traceId, cid }, 'Trace pinned to IPFS');
    return { cid, sha256Hash };
}
async function pinWithRetry(payload, traceId, attempt = 1) {
    try {
        const { data } = await axios_1.default.post(`${PINATA_BASE}/pinning/pinJSONToIPFS`, {
            pinataContent: payload,
            pinataMetadata: {
                name: `oracledesk-trace-${traceId}`,
                keyvalues: { traceId, version: '1.0' },
            },
            pinataOptions: { cidVersion: 1 },
        }, {
            headers: pinataHeaders(),
            timeout: 20000,
        });
        return data.IpfsHash;
    }
    catch (err) {
        if (attempt < 2) {
            logger_1.logger.warn({ attempt }, 'IPFS upload failed — retrying in 3s');
            await sleep(3000);
            return pinWithRetry(payload, traceId, attempt + 1);
        }
        throw err;
    }
}
/**
 * Retrieves a reasoning trace from IPFS via the Pinata gateway.
 *
 * Two methods supported:
 * 1. Gateway URL: https://gateway.pinata.cloud/ipfs/{CID}
 * 2. Direct IPFS: https://ipfs.io/ipfs/{CID}
 *
 * Falls back to direct IPFS if gateway fails.
 */
async function retrieveTrace(cid) {
    const urls = [
        `${IPFS_GATEWAY}/${cid}`,
        `https://ipfs.io/ipfs/${cid}`,
    ];
    for (const url of urls) {
        try {
            const { data } = await axios_1.default.get(url, { timeout: 15000 });
            return data;
        }
        catch {
            logger_1.logger.warn({ url }, 'IPFS gateway failed — trying next');
        }
    }
    throw new error_middleware_1.AppError(502, 'IPFS_RETRIEVAL_FAILED', 'Could not retrieve trace from any IPFS gateway', { cid });
}
/**
 * Verifies a reasoning trace's integrity.
 *
 * Verification steps:
 * 1. Look up the trace in the DB to get stored sha256Hash and CID
 * 2. Fetch the raw content from IPFS using the CID
 * 3. SHA-256 hash the fetched content locally
 * 4. Compare computed hash vs stored hash
 *
 * If hashes match → the trace has not been tampered with since publishing.
 * If hashes differ → the content was modified after the CID was issued.
 */
async function verifyCID(traceId) {
    const trace = await prisma_1.prisma.reasoningTrace.findUnique({
        where: { id: traceId },
        select: { ipfsCid: true, sha256Hash: true },
    });
    if (!trace?.ipfsCid || !trace?.sha256Hash) {
        throw new error_middleware_1.AppError(404, 'TRACE_NOT_PINNED', 'Trace has not been pinned to IPFS yet');
    }
    let fetchedContent;
    try {
        fetchedContent = await retrieveTrace(trace.ipfsCid);
    }
    catch {
        throw new error_middleware_1.AppError(502, 'IPFS_VERIFICATION_FAILED', 'Could not fetch trace from IPFS for verification');
    }
    const computedHash = (0, hash_util_1.sha256Json)(fetchedContent);
    const verified = computedHash === trace.sha256Hash;
    // Update DB verification status
    await prisma_1.prisma.reasoningTrace.update({
        where: { id: traceId },
        data: { verified },
    });
    return {
        traceId,
        ipfsCid: trace.ipfsCid,
        storedHash: trace.sha256Hash,
        computedHash,
        verified,
        verifiedAt: new Date(),
    };
}
/**
 * List all pins for this project via Pinata's pinning API.
 * Useful for auditing and reconciliation.
 */
async function listPins() {
    try {
        const { data } = await axios_1.default.get(`${PINATA_BASE}/data/pinList?status=pinned&pageLimit=100`, { headers: pinataHeaders(), timeout: 10000 });
        return (data.rows ?? []).map((r) => ({
            cid: r.ipfs_pin_hash,
            name: r.metadata?.name ?? '',
        }));
    }
    catch (err) {
        logger_1.logger.error({ err }, 'Failed to list Pinata pins');
        return [];
    }
}
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
