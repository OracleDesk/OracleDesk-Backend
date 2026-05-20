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
    CIRCLE_BASE_URL: zod_1.z.string().url().default('https://api.circle.com'),
    CIRCLE_WALLET_ID: zod_1.z.string().default(''),
    CIRCLE_WALLET_ADDRESS: zod_1.z.string().default(''),
    CIRCLE_BLOCKCHAIN: zod_1.z.string().default('ARC-TESTNET'),
    CIRCLE_STRICT_PAYMENT_VERIFICATION: zod_1.z.string().default('false').transform(v => v === 'true'),
    USDC_TOKEN_ADDRESS: zod_1.z.string().default('0x3600000000000000000000000000000000000000'),
    EURC_TOKEN_ADDRESS: zod_1.z.string().default('0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a'),
    TREASURY_MANAGER_ADDRESS: zod_1.z.string().default('0xb326E280D2e115B6BEC25154142970a90074e7F8'),
    POSITION_LEDGER_ADDRESS: zod_1.z.string().default('0x4ac9c8A1F68c6d8979343746825Df09DD1907b44'),
    MULTISIG_ORACLE_ADDRESS: zod_1.z.string().default('0xD21251d0f66245C1B259d720F3795633a803b8B9'),
    MARKET_FACTORY_ADDRESS: zod_1.z.string().default('0xF5b7E790168aF77418Ab9eC37Cb7Eb7851e4a36a'),
    REASONING_REGISTRY_ADDRESS: zod_1.z.string().default('0xE3188B3b4E14d74E6110137FF91f12B981A82257'),
    POLYMARKET_BUILDER_CODE: zod_1.z.string().default('0x0000000000000000000000000000000000000000'),
    JWT_SECRET: zod_1.z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    AGENT_PRIVATE_KEY: zod_1.z.string().default(''),
    AGENT_WALLET_ADDRESS: zod_1.z.string().default(''),
    CHAIN_EXECUTION_MODE: zod_1.z.enum(['mock', 'wallet', 'circle']).default('mock'),
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
