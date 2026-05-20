"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendSuccess = sendSuccess;
exports.sendError = sendError;
exports.buildPaginationMeta = buildPaginationMeta;
exports.parsePagination = parsePagination;
/**
 * Send a successful 2xx response
 */
function sendSuccess(res, data, statusCode = 200, meta) {
    const body = { ok: true, data, error: null, meta };
    res.status(statusCode).json(body);
}
/**
 * Send an error response
 */
function sendError(res, statusCode, code, message, details) {
    const error = { code, message, details };
    const body = { ok: false, data: null, error };
    res.status(statusCode).json(body);
}
/**
 * Build a pagination meta object
 */
function buildPaginationMeta(page, limit, total) {
    return { page, limit, total, totalPages: Math.ceil(total / limit) };
}
/**
 * Parse pagination query params with safe defaults
 */
function parsePagination(query) {
    const page = Math.max(1, parseInt(String(query.page ?? '1'), 10));
    const limit = Math.min(100, Math.max(1, parseInt(String(query.limit ?? '20'), 10)));
    return { page, limit, skip: (page - 1) * limit };
}
