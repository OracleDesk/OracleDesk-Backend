"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sha256Json = sha256Json;
exports.sha256String = sha256String;
exports.verifyHash = verifyHash;
const crypto_1 = __importDefault(require("crypto"));
/**
 * Compute SHA-256 hash of a JSON object.
 * The object is deterministically stringified before hashing.
 */
function sha256Json(data) {
    // Sort keys deterministically so the same object always produces the same hash
    const stable = JSON.stringify(data, Object.keys(data).sort());
    return crypto_1.default.createHash('sha256').update(stable, 'utf8').digest('hex');
}
/**
 * Compute SHA-256 hash of a raw string
 */
function sha256String(input) {
    return crypto_1.default.createHash('sha256').update(input, 'utf8').digest('hex');
}
/**
 * Verify a hash against a known value (constant-time comparison)
 */
function verifyHash(input, expectedHash) {
    const inputHash = sha256String(input);
    // timingSafeEqual prevents timing attacks
    try {
        return crypto_1.default.timingSafeEqual(Buffer.from(inputHash, 'hex'), Buffer.from(expectedHash, 'hex'));
    }
    catch {
        return false;
    }
}
