import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  DATABASE_URL:               z.string().min(1, 'DATABASE_URL is required'),
  PORT:                       z.string().default('8000').transform(Number),
  NODE_ENV:                   z.enum(['development', 'production', 'test']).default('development'),

  GEMINI_API_KEY:             z.string().min(1, 'GEMINI_API_KEY is required'),

  PINATA_API_KEY:             z.string().min(1, 'PINATA_API_KEY is required'),
  PINATA_SECRET_API_KEY:      z.string().min(1, 'PINATA_SECRET_API_KEY is required'),

  ARC_RPC_URL:                z.string().min(1).default('https://rpc.arc.fun'),
  ARC_CHAIN_ID:               z.string().default('1338').transform(Number),

  CIRCLE_API_KEY:             z.string().default(''),
  CIRCLE_ENTITY_SECRET:       z.string().default(''),
  CIRCLE_BASE_URL:            z.string().url().default('https://api.circle.com'),
  CIRCLE_WALLET_ID:           z.string().default(''),
  CIRCLE_WALLET_ADDRESS:      z.string().default(''),
  CIRCLE_BLOCKCHAIN:          z.string().default('ARC-TESTNET'),
  CIRCLE_STRICT_PAYMENT_VERIFICATION: z.string().default('false').transform(v => v === 'true'),

  USDC_TOKEN_ADDRESS:         z.string().default('0x3600000000000000000000000000000000000000'),
  EURC_TOKEN_ADDRESS:         z.string().default('0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a'),
  TREASURY_MANAGER_ADDRESS:   z.string().default('0xb326E280D2e115B6BEC25154142970a90074e7F8'),
  POSITION_LEDGER_ADDRESS:    z.string().default('0x4ac9c8A1F68c6d8979343746825Df09DD1907b44'),
  MULTISIG_ORACLE_ADDRESS:    z.string().default('0xD21251d0f66245C1B259d720F3795633a803b8B9'),
  MARKET_FACTORY_ADDRESS:     z.string().default('0xF5b7E790168aF77418Ab9eC37Cb7Eb7851e4a36a'),
  REASONING_REGISTRY_ADDRESS: z.string().default('0xE3188B3b4E14d74E6110137FF91f12B981A82257'),

  POLYMARKET_BUILDER_CODE:    z.string().default('0x0000000000000000000000000000000000000000'),
  JWT_SECRET:                 z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  AGENT_PRIVATE_KEY:          z.string().default(''),
  AGENT_WALLET_ADDRESS:       z.string().default(''),
  CHAIN_EXECUTION_MODE:       z.enum(['mock', 'wallet', 'circle']).default('mock'),

  NEWSAPI_KEY:                z.string().default(''),
  FRED_API_KEY:               z.string().default(''),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;
