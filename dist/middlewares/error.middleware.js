"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppError = void 0;
exports.errorMiddleware = errorMiddleware;
const logger_1 = require("../lib/logger");
const response_util_1 = require("../utils/response.util");
class AppError extends Error {
    constructor(statusCode, code, message, details) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
        this.name = 'AppError';
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.AppError = AppError;
/**
 * Global Express error handler.
 * Catches AppError instances and any unhandled errors.
 */
function errorMiddleware(err, req, res, _next) {
    if (err instanceof AppError) {
        logger_1.logger.warn({ code: err.code, path: req.path, details: err.details }, err.message);
        (0, response_util_1.sendError)(res, err.statusCode, err.code, err.message, err.details);
        return;
    }
    // Unexpected errors — log the full stack
    logger_1.logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');
    (0, response_util_1.sendError)(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred');
}
