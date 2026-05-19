"use strict";
// This file validates incoming requests for market-related endpoints using Zod schemas. 
// It defines the expected structure of the request body and query parameters for creating and listing markets, ensuring that the data adheres to the specified formats and constraints before being processed by the controllers.
Object.defineProperty(exports, "__esModule", { value: true });
exports.listMarketsSchema = exports.createMarketSchema = void 0;
const zod_1 = require("zod");
exports.createMarketSchema = zod_1.z.object({
    body: zod_1.z.object({
        question: zod_1.z.string().min(10, 'Question must be at least 10 characters'),
        category: zod_1.z.enum(['FED', 'ECB', 'ELECTION', 'GEOPOLITICAL', 'CRYPTO', 'MACRO', "SPORTS", "ENTERTAINMENT", "POLITICS"]),
        settlementCurrency: zod_1.z.enum(['USDC', 'EURC']).default('USDC'),
        expiryTimestamp: zod_1.z.number().int().positive(),
        resolutionOracle: zod_1.z.string().optional(),
        minimumLiquidity: zod_1.z.number().positive().default(100),
    }),
});
exports.listMarketsSchema = zod_1.z.object({
    query: zod_1.z.object({
        status: zod_1.z.enum(['PENDING', 'ACTIVE', 'RESOLVING', 'RESOLVED', 'CANCELLED']).optional(),
        category: zod_1.z.enum(['FED', 'ECB', 'ELECTION', 'GEOPOLITICAL', 'CRYPTO', 'MACRO', "SPORTS", "ENTERTAINMENT", "POLITICS"]).optional(),
        currency: zod_1.z.enum(['USDC', 'EURC']).optional(),
        page: zod_1.z.string().optional(),
        limit: zod_1.z.string().optional(),
    }),
});
