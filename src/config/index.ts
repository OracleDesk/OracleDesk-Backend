import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  DATABASE_URL:               z.string().min(1, 'DATABASE_URL is required'),
  PORT:                       z.string().default('8000').transform(Number),
  NODE_ENV:                   z.enum(['development', 'production', 'test']).default('development'),

  ANTHROPIC_API_KEY:          z.string().min(1, 'ANTHROPIC_API_KEY is required'),

  PINATA_API_KEY:             z.string().min(1, 'PINATA_API_KEY is required'),
  PINATA_SECRET_API_KEY:      z.string().min(1, 'PINATA_SECRET_API_KEY is required'),

  ARC_RPC_URL:                z.string().min(1).default('https://rpc.arc.fun'),
  ARC_CHAIN_ID:               z.string().default('1338').transform(Number),

  CIRCLE_API_KEY:             z.string().default(''),
  CIRCLE_ENTITY_SECRET:       z.string().default(''),

  USDC_TOKEN_ADDRESS:         z.string().default('0x0000000000000000000000000000000000000000'),
  EURC_TOKEN_ADDRESS:         z.string().default('0x0000000000000000000000000000000000000000'),
  MARKET_FACTORY_ADDRESS:     z.string().default('0x0000000000000000000000000000000000000000'),
  REASONING_REGISTRY_ADDRESS: z.string().default('0x0000000000000000000000000000000000000000'),

  POLYMARKET_BUILDER_CODE:    z.string().default('0x0000000000000000000000000000000000000000'),
  JWT_SECRET:                 z.string().min(32, 'JWT_SECRET must be at least 32 characters'),

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