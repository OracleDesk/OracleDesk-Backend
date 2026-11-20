import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv } from './helpers/env';

setupTestEnv();

// #243 — config keys that are set but have no effect.

test('typo CHANEL_LEASE_MS suggests CHANNEL_LEASE_MS', async () => {
  const { envObjectSchema } = await import('../src/config');
  const { collectConfigWarnings } = await import('../src/config/meta');
  const warnings = collectConfigWarnings(
    { CHANEL_LEASE_MS: '1000' },
    Object.keys(envObjectSchema.shape),
    [],
  );
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].kind, 'unknown');
  assert.match(warnings[0].message, /did you mean CHANNEL_LEASE_MS\?/);
});

test('reserved key set at boot warns has no effect', async () => {
  const { envObjectSchema } = await import('../src/config');
  const { collectConfigWarnings } = await import('../src/config/meta');
  const warnings = collectConfigWarnings({ KEEPER_ENABLED: 'true' }, Object.keys(envObjectSchema.shape), []);
  assert.deepEqual(warnings.map((w) => w.kind), ['reserved']);
  assert.match(warnings[0].message, /KEEPER_ENABLED has no effect/);
});

test('deprecated key warns with its removal release', async () => {
  const { envObjectSchema } = await import('../src/config');
  const { collectConfigWarnings } = await import('../src/config/meta');
  const warnings = collectConfigWarnings({ SOCKET_LIVE_LEDGER_LAG: '5' }, Object.keys(envObjectSchema.shape), []);
  assert.deepEqual(warnings.map((w) => w.kind), ['deprecated']);
  assert.match(warnings[0].message, /removed after v1\.2\.0/);
});

test('KEY_FILE for secrets, active keys and foreign prefixes are not flagged', async () => {
  const { envObjectSchema } = await import('../src/config');
  const { SECRET_NAMES } = await import('../src/config/secrets');
  const { collectConfigWarnings } = await import('../src/config/meta');
  const warnings = collectConfigWarnings(
    {
      JWT_SECRET_FILE: '/run/secrets/jwt',
      CHANNEL_LEASE_MS: '1000',
      NODE_OPTIONS: '--max-old-space-size=4096',
      HOSTNAME: 'box',
    },
    Object.keys(envObjectSchema.shape),
    SECRET_NAMES,
  );
  assert.deepEqual(warnings, []);
});

test('every lifecycle entry names a schema key', async () => {
  const { envObjectSchema } = await import('../src/config');
  const { KEY_LIFECYCLE } = await import('../src/config/meta');
  const keys = new Set(Object.keys(envObjectSchema.shape));
  for (const key of Object.keys(KEY_LIFECYCLE)) assert.ok(keys.has(key), `${key} is not in envSchema`);
});

test('CONFIG_STRICT turns warnings into ConfigError', async () => {
  const { loadConfig, ConfigError } = await import('../src/config');
  assert.throws(
    () => loadConfig({ DATABASE_URL: 'x', NODE_ENV: 'test', CONFIG_STRICT: 'true', KEEPER_ENABLED: 'true' }),
    (err: unknown) => err instanceof ConfigError && /KEEPER_ENABLED has no effect/.test(err.message),
  );
  // Without strict mode the same env still loads.
  const c = loadConfig({ DATABASE_URL: 'x', NODE_ENV: 'test', KEEPER_ENABLED: 'true' });
  assert.equal(c.CONFIG_STRICT, false);
});

test('editDistance', async () => {
  const { editDistance } = await import('../src/config/meta');
  assert.equal(editDistance('CHANEL_LEASE_MS', 'CHANNEL_LEASE_MS'), 1);
  assert.equal(editDistance('abc', 'abc'), 0);
  assert.ok(editDistance('KEEPER_ENABLED', 'X402_ENABLED', 2) > 2);
});
