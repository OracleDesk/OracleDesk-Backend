export function setupTestEnv(): void {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-anthropic-key';
  process.env.PINATA_API_KEY = process.env.PINATA_API_KEY || 'test-pinata-key';
  process.env.PINATA_SECRET_API_KEY = process.env.PINATA_SECRET_API_KEY || 'test-pinata-secret';
  process.env.JWT_SECRET = process.env.JWT_SECRET || '01234567890123456789012345678901';
  process.env.ARC_RPC_URL = process.env.ARC_RPC_URL || 'http://127.0.0.1:8545';
  process.env.ARC_CHAIN_ID = process.env.ARC_CHAIN_ID || '1338';
  process.env.CHAIN_EXECUTION_MODE = 'mock';
  process.env.CIRCLE_STRICT_PAYMENT_VERIFICATION = 'false';
  process.env.CIRCLE_API_KEY = '';
  process.env.CIRCLE_ENTITY_SECRET = '';
}
