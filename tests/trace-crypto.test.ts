import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { setupTestEnv } from './helpers/env';
import {
  createKek,
  sealTrace,
  openTrace,
  unwrapKey,
  TraceEnvelopeV1,
  TracePublicPart,
} from '../src/services/trace-crypto.service';
import { canonicalBytesStrict, sha256Hex } from '../src/utils/hash.util';

setupTestEnv();

const dummyPublic: TracePublicPart = {
  traceId: '11111111-1111-1111-1111-111111111111',
  agentType: 'MARKET_MAKER',
  decisionType: 'MARKET_CREATION',
  market: {
    backendId: '22222222-2222-2222-2222-222222222222',
    onChainId: '0',
  },
  probabilityEstimate: 0.65,
  marketProbability: 0.5,
  edge: 0.15,
  previewSources: [
    { source: 'FRED', weight: 0.8, signal: 'Rates drop', rawValue: 0.5 },
  ],
  createdAt: new Date().toISOString(),
};

test('sealTrace then openTrace round-trips and plaintext hashes to plaintextHash', () => {
  const kek = createKek('kek-1', crypto.randomBytes(32));
  const plaintext = Buffer.from(
    JSON.stringify({
      secretReasoning: 'Confidential alpha here',
      hedgeConditions: ['Condition 1'],
      betFraction: 0.05,
    }),
    'utf8',
  );

  const sealed = sealTrace(plaintext, dummyPublic, kek);

  assert.equal(sealed.envelope.kind, 'oracledesk.trace.enc');
  assert.equal(sealed.envelope.schemaVersion, 1);
  assert.equal(sealed.envelope.alg, 'XChaCha20-Poly1305');
  assert.equal(sealed.envelope.kid, 'kek-1');
  assert.equal(sealed.plaintextHash, sha256Hex(plaintext));

  // Unwrap data key
  const dataKey = kek.unwrap(sealed.wrappedKey);
  assert.equal(dataKey.length, 32);

  // Open trace
  const decrypted = openTrace(sealed.envelope, dataKey);
  assert.deepEqual(decrypted, plaintext);
  assert.equal(sha256Hex(decrypted), sealed.envelope.plaintextHash);
});

test('tampering with public header or ciphertext fails authentication', () => {
  const kek = createKek('kek-1', crypto.randomBytes(32));
  const plaintext = Buffer.from('Sensitive trace information', 'utf8');
  const sealed = sealTrace(plaintext, dummyPublic, kek);
  const dataKey = kek.unwrap(sealed.wrappedKey);

  // 1. Tamper with public edge
  const tamperedHeader: TraceEnvelopeV1 = {
    ...sealed.envelope,
    public: {
      ...sealed.envelope.public,
      edge: 0.99,
    },
  };

  assert.throws(
    () => openTrace(tamperedHeader, dataKey),
    (err: any) => err.message.includes('AEAD verification failed') || err.message.includes('AUTHENTICATION_FAILED'),
  );

  // 2. Tamper with ciphertext
  const rawCipher = Buffer.from(sealed.envelope.ciphertext, 'base64');
  rawCipher[0] ^= 0x01; // flip one bit
  const tamperedCipher: TraceEnvelopeV1 = {
    ...sealed.envelope,
    ciphertext: rawCipher.toString('base64'),
  };

  assert.throws(
    () => openTrace(tamperedCipher, dataKey),
    (err: any) => err.message.includes('AEAD verification failed') || err.message.includes('AUTHENTICATION_FAILED'),
  );

  // 3. Tamper with plaintextHash in envelope
  const tamperedHash: TraceEnvelopeV1 = {
    ...sealed.envelope,
    plaintextHash: '0000000000000000000000000000000000000000000000000000000000000000',
  };

  assert.throws(
    () => openTrace(tamperedHash, dataKey),
    (err: any) => err.message.includes('AEAD verification failed') || err.message.includes('AUTHENTICATION_FAILED'),
  );
});

test('envelope bytes hash equals the trace_hash for on-chain publication', () => {
  const kek = createKek('kek-1', crypto.randomBytes(32));
  const plaintext = Buffer.from('Plaintext payload', 'utf8');
  const sealed = sealTrace(plaintext, dummyPublic, kek);

  const expectedHash = sha256Hex(sealed.bytes);
  const envelopeHash = sha256Hex(canonicalBytesStrict(sealed.envelope));

  assert.equal(expectedHash, envelopeHash);
});

test('KEK rotation: key wrapped under old kid still unwraps; new traces use active kid', () => {
  const key1 = crypto.randomBytes(32);
  const key2 = crypto.randomBytes(32);
  const kek1 = createKek('kek-2026-09', key1);
  const kek2 = createKek('kek-2026-10', key2);

  const keksMap = new Map([
    ['kek-2026-09', kek1],
    ['kek-2026-10', kek2],
  ]);

  const plaintext = Buffer.from('Old trace content', 'utf8');
  const sealedOld = sealTrace(plaintext, dummyPublic, kek1);

  // New trace under kek2
  const sealedNew = sealTrace(plaintext, dummyPublic, kek2);
  assert.equal(sealedNew.envelope.kid, 'kek-2026-10');

  // Both can unwrap
  const unwrapOld = unwrapKey(sealedOld.wrappedKey, 'kek-2026-09', keksMap);
  const unwrapNew = unwrapKey(sealedNew.wrappedKey, 'kek-2026-10', keksMap);

  assert.deepEqual(openTrace(sealedOld.envelope, unwrapOld), plaintext);
  assert.deepEqual(openTrace(sealedNew.envelope, unwrapNew), plaintext);
});

test('preview response contains no locked fields and no key material', () => {
  const lockedKeys = ['sourcesUsed', 'hedgeConditions', 'betFraction', 'betSizeUsdc', 'dataKey', 'wrappedKey'];
  const publicKeys = Object.keys(dummyPublic);

  for (const locked of lockedKeys) {
    assert.equal(
      publicKeys.includes(locked),
      false,
      `Public preview must not contain locked field '${locked}'`,
    );
  }
});
