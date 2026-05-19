"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.kellyInputSchema = exports.copyTradeSchema = void 0;
const zod_1 = require("zod");
exports.copyTradeSchema = zod_1.z.object({
    body: zod_1.z.object({
        traceId: zod_1.z.string().uuid('Invalid trace ID'),
        marketId: zod_1.z.string().uuid('Invalid market ID'),
        amount: zod_1.z.number().positive('Amount must be positive'),
        userWallet: zod_1.z.string().min(42).max(42, 'Invalid wallet address'),
    }),
});
exports.kellyInputSchema = zod_1.z.object({
    agentProbability: zod_1.z.number().min(0).max(1),
    marketProbability: zod_1.z.number().min(0).max(1),
    bankroll: zod_1.z.number().positive(),
    netOdds: zod_1.z.number().positive(),
});
