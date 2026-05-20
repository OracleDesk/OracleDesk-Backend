"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.approveResolution = approveResolution;
exports.getResolution = getResolution;
const response_util_1 = require("../utils/response.util");
const oracle_service_1 = require("../services/oracle.service");
async function approveResolution(req, res) {
    const { marketId, yesWon, rationale } = req.body;
    if (!marketId || typeof yesWon !== 'boolean') {
        (0, response_util_1.sendError)(res, 400, 'INVALID_RESOLUTION_INPUT', 'marketId and boolean yesWon are required');
        return;
    }
    const result = await (0, oracle_service_1.approveMarketResolution)({ marketId, yesWon, rationale });
    (0, response_util_1.sendSuccess)(res, result, 202);
}
async function getResolution(req, res) {
    const marketId = String(req.params.marketId);
    const result = await (0, oracle_service_1.getResolutionStatus)(marketId);
    (0, response_util_1.sendSuccess)(res, result);
}
