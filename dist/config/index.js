"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
const zod_1 = require("zod");
dotenv_1.default.config();
const envSchema = zod_1.z.object({
    DATABASE_URL: zod_1.z.string().min(1, 'DATABASE_URL is required'),
    PORT: zod_1.z.string().default('8000').transform(Number),
    NODE_ENV: zod_1.z.enum(['development', 'production', 'test']).default('development'),
    ANTHROPIC_API_KEY: zod_1.z.string().min(1, 'ANTHROPIC_API_KEY is required'),
    PINATA_API_KEY: zod_1.z.string().min(1, 'PINATA_API_KEY is required'),
    PINATA_SECRET_API_KEY: zod_1.z.string().min(1, 'PINATA_SECRET_API_KEY is required'),
    ARC_RPC_URL: zod_1.z.string().min(1).default('https://rpc.arc.fun'),
    ARC_CHAIN_ID: zod_1.z.string().default('1338').transform(Number),
    CIRCLE_API_KEY: zod_1.z.string().default(''),
    CIRCLE_ENTITY_SECRET: zod_1.z.string().default(''),
    USDC_TOKEN_ADDRESS: zod_1.z.string().default('0x0000000000000000000000000000000000000000'),
    EURC_TOKEN_ADDRESS: zod_1.z.string().default('0x0000000000000000000000000000000000000000'),
    MARKET_FACTORY_ADDRESS: zod_1.z.string().default('0x0000000000000000000000000000000000000000'),
    REASONING_REGISTRY_ADDRESS: zod_1.z.string().default('0x0000000000000000000000000000000000000000'),
    POLYMARKET_BUILDER_CODE: zod_1.z.string().default('0x0000000000000000000000000000000000000000'),
    JWT_SECRET: zod_1.z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    NEWSAPI_KEY: zod_1.z.string().default(''),
    FRED_API_KEY: zod_1.z.string().default(''),
});
const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
    console.error('❌ Invalid environment variables:');
    console.error(parsed.error.flatten().fieldErrors);
    process.exit(1);
}
exports.config = parsed.data;
