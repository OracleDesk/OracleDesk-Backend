import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@stellar/stellar-sdk';
import { setupTestEnv } from './helpers/env';

setupTestEnv();

test('config names every missing or invalid variable', async () => {
  const { loadConfig } = await import('../src/config');
  assert.throws(() => loadConfig({}), /DATABASE_URL is required/);
  assert.throws(() => loadConfig({ DATABASE_URL: 'x', ADMIN_ADDRESSES: '0xabc' }), /ADMIN_ADDRESSES/);
  assert.throws(() => loadConfig({ DATABASE_URL: 'x', CHAIN_EXECUTION_MODE: 'live' }), /AGENT_SECRET_KEY is required/);
  assert.throws(() => loadConfig({ DATABASE_URL: 'x', CHAIN_EXECUTION_MODE: 'mock' }), /CHAIN_EXECUTION_MODE/);
  assert.throws(
    () => loadConfig({ DATABASE_URL: 'x', CHAIN_EXECUTION_MODE: 'live', AGENT_SECRET_KEY: Keypair.random().secret(), STELLAR_NETWORK_PASSPHRASE: 'Public Global Stellar Network ; September 2015' }),
    /testnet-only/,
  );
  assert.throws(() => loadConfig({ DATABASE_URL: 'x', NODE_ENV: 'production' }), /JWT_SECRET is required in production/);
});

test('defaults to dry-run on testnet, and generates dev-only ephemeral secrets', async () => {
  const { loadConfig } = await import('../src/config');
  const c = loadConfig({ DATABASE_URL: 'x' });
  assert.equal(c.CHAIN_EXECUTION_MODE, 'dry-run');
  assert.equal(c.STELLAR_NETWORK_PASSPHRASE, 'Test SDF Network ; September 2015');
  assert.deepEqual(c.ephemeralSecrets.sort(), ['AUTH_SIGNING_SECRET', 'JWT_SECRET', 'WEBHOOK_SECRET_KEY']);
});

test('validates webhook settings (#128)', async () => {
  const { loadConfig } = await import('../src/config');
  const prod = { DATABASE_URL: 'x', NODE_ENV: 'production', JWT_SECRET: '01234567890123456789012345678901', AUTH_SIGNING_SECRET: Keypair.random().secret() };
  assert.throws(() => loadConfig(prod), /WEBHOOK_SECRET_KEY is required in production/);
  assert.throws(() => loadConfig({ DATABASE_URL: 'x', WEBHOOK_SECRET_KEY: 'c2hvcnQ=' }), /WEBHOOK_SECRET_KEY must be 32 bytes/);
  const key = Buffer.alloc(32, 7).toString('base64');
  assert.throws(() => loadConfig({ ...prod, WEBHOOK_SECRET_KEY: key, WEBHOOKS_ALLOW_HTTP: 'true' }), /WEBHOOKS_ALLOW_HTTP must not be true in production/);
  assert.equal(loadConfig({ ...prod, WEBHOOKS_ENABLED: 'false' }).WEBHOOKS_ENABLED, false);
  const ok = loadConfig({ ...prod, WEBHOOK_SECRET_KEY: key });
  assert.equal(ok.WEBHOOK_SECRET_KEY, key);
  assert.ok(!ok.ephemeralSecrets.includes('WEBHOOK_SECRET_KEY'));
});
