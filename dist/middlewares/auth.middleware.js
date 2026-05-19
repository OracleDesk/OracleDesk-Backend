"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
exports.signToken = signToken;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const config_1 = require("../config");
const response_util_1 = require("../utils/response.util");
/**
 * Require a valid JWT Bearer token. Attaches decoded payload to req.user.
 */
function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        (0, response_util_1.sendError)(res, 401, 'UNAUTHORIZED', 'Missing or malformed Authorization header');
        return;
    }
    const token = authHeader.slice(7);
    try {
        const decoded = jsonwebtoken_1.default.verify(token, config_1.config.JWT_SECRET);
        req.user = decoded;
        next();
    }
    catch (err) {
        if (err instanceof jsonwebtoken_1.default.TokenExpiredError) {
            (0, response_util_1.sendError)(res, 401, 'TOKEN_EXPIRED', 'Token has expired');
        }
        else {
            (0, response_util_1.sendError)(res, 401, 'INVALID_TOKEN', 'Token is invalid');
        }
    }
}
/**
 * Generate a signed JWT for a user
 */
function signToken(userId, walletAddress) {
    return jsonwebtoken_1.default.sign({ userId, walletAddress }, config_1.config.JWT_SECRET, { expiresIn: '7d' });
}
