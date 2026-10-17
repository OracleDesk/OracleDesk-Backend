import crypto from 'node:crypto';
import type { Config } from '../config';
import { config as defaultConfig } from '../config';
import { canonicalBytesStrict, sha256Hex } from '../utils/hash.util';
import { AppError } from '../middlewares/error.middleware';

export interface TracePublicPart {
  traceId: string;
  agentType: 'MARKET_MAKER' | 'TRADER';
  decisionType: string;
  market: {
    backendId: string;
    onChainId: string | null;
  };
  probabilityEstimate: number;
  marketProbability: number;
  edge: number;
  previewSources: Array<{
    source: string;
    weight: number;
    signal: string;
    rawValue: number | null;
  }>;
  createdAt: string;
}

export interface TraceEnvelopeV1 {
  kind: 'oracledesk.trace.enc';
  schemaVersion: 1;
  alg: 'XChaCha20-Poly1305';
  kid: string;
  plaintextHash: string;
  public: TracePublicPart;
  nonce: string; // base64 24 bytes
  ciphertext: string; // base64
}

export interface SealedTrace {
  envelope: TraceEnvelopeV1;
  bytes: Buffer;
  plaintextHash: string;
  wrappedKey: Buffer;
  kid: string;
}

export interface Kek {
  kid: string;
  wrap(dk: Buffer): Buffer;
  unwrap(w: Buffer): Buffer;
}

// ─── HChaCha20 and XChaCha20-Poly1305 Implementation ──────────────────────────

function rotl(a: number, b: number): number {
  return ((a << b) | (a >>> (32 - b))) >>> 0;
}

function qround(state: Uint32Array, a: number, b: number, c: number, d: number) {
  state[a] = (state[a] + state[b]) >>> 0;
  state[d] = rotl(state[d] ^ state[a], 16);
  state[c] = (state[c] + state[d]) >>> 0;
  state[b] = rotl(state[b] ^ state[c], 12);
  state[a] = (state[a] + state[b]) >>> 0;
  state[d] = rotl(state[d] ^ state[a], 8);
  state[c] = (state[c] + state[d]) >>> 0;
  state[b] = rotl(state[b] ^ state[c], 7);
}

export function hchacha20(key: Buffer, nonce: Buffer): Buffer {
  if (key.length !== 32) throw new Error('HChaCha20 requires a 32-byte key');
  if (nonce.length !== 16) throw new Error('HChaCha20 requires a 16-byte nonce');

  const state = new Uint32Array(16);
  // Constants: "expand 32-byte k"
  state[0] = 0x61707865;
  state[1] = 0x3320646e;
  state[2] = 0x79622d32;
  state[3] = 0x6b206574;

  for (let i = 0; i < 8; i++) {
    state[4 + i] = key.readUInt32LE(i * 4);
  }
  for (let i = 0; i < 4; i++) {
    state[12 + i] = nonce.readUInt32LE(i * 4);
  }

  for (let i = 0; i < 10; i++) {
    // Column round
    qround(state, 0, 4, 8, 12);
    qround(state, 1, 5, 9, 13);
    qround(state, 2, 6, 10, 14);
    qround(state, 3, 7, 11, 15);
    // Diagonal round
    qround(state, 0, 5, 10, 15);
    qround(state, 1, 6, 11, 12);
    qround(state, 2, 7, 8, 13);
    qround(state, 3, 4, 9, 14);
  }

  const out = Buffer.alloc(32);
  out.writeUInt32LE(state[0], 0);
  out.writeUInt32LE(state[1], 4);
  out.writeUInt32LE(state[2], 8);
  out.writeUInt32LE(state[3], 12);
  out.writeUInt32LE(state[12], 16);
  out.writeUInt32LE(state[13], 20);
  out.writeUInt32LE(state[14], 24);
  out.writeUInt32LE(state[15], 28);
  return out;
}

export function xchacha20poly1305Encrypt(
  key: Buffer,
  nonce24: Buffer,
  plaintext: Buffer,
  aad: Buffer,
): Buffer {
  if (key.length !== 32) throw new Error('Key must be 32 bytes');
  if (nonce24.length !== 24) throw new Error('Nonce must be 24 bytes');

  const subKey = hchacha20(key, nonce24.subarray(0, 16));
  const iv12 = Buffer.concat([Buffer.alloc(4, 0), nonce24.subarray(16, 24)]);

  const cipher = crypto.createCipheriv('chacha20-poly1305', subKey, iv12, {
    authTagLength: 16,
  });
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([encrypted, tag]);
}

export function xchacha20poly1305Decrypt(
  key: Buffer,
  nonce24: Buffer,
  ciphertextWithTag: Buffer,
  aad: Buffer,
): Buffer {
  if (key.length !== 32) throw new Error('Key must be 32 bytes');
  if (nonce24.length !== 24) throw new Error('Nonce must be 24 bytes');
  if (ciphertextWithTag.length < 16) throw new Error('Ciphertext must include 16-byte auth tag');

  const subKey = hchacha20(key, nonce24.subarray(0, 16));
  const iv12 = Buffer.concat([Buffer.alloc(4, 0), nonce24.subarray(16, 24)]);

  const tag = ciphertextWithTag.subarray(ciphertextWithTag.length - 16);
  const cipherText = ciphertextWithTag.subarray(0, ciphertextWithTag.length - 16);

  const decipher = crypto.createDecipheriv('chacha20-poly1305', subKey, iv12, {
    authTagLength: 16,
  });
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(cipherText), decipher.final()]);
}

// ─── KEK Management ──────────────────────────────────────────────────────────

export function createKek(kid: string, rawKey32: Buffer): Kek {
  if (rawKey32.length !== 32) {
    throw new Error(`KEK ${kid} must be 32 bytes`);
  }
  return {
    kid,
    wrap(dk: Buffer): Buffer {
      if (dk.length !== 32) throw new Error('Data key must be 32 bytes');
      const nonce = crypto.randomBytes(24);
      const aad = Buffer.from(`kek-wrap:${kid}`, 'utf8');
      const enc = xchacha20poly1305Encrypt(rawKey32, nonce, dk, aad);
      return Buffer.concat([nonce, enc]);
    },
    unwrap(wrapped: Buffer): Buffer {
      if (wrapped.length < 24 + 16) throw new Error('Invalid wrapped key length');
      const nonce = wrapped.subarray(0, 24);
      const enc = wrapped.subarray(24);
      const aad = Buffer.from(`kek-wrap:${kid}`, 'utf8');
      return xchacha20poly1305Decrypt(rawKey32, nonce, enc, aad);
    },
  };
}

export function loadKeks(cfg: Config = defaultConfig): Map<string, Kek> {
  const map = new Map<string, Kek>();
  if (!cfg.TRACE_KEKS) return map;

  try {
    const parsed = typeof cfg.TRACE_KEKS === 'string' ? JSON.parse(cfg.TRACE_KEKS) : cfg.TRACE_KEKS;
    for (const [kid, b64] of Object.entries(parsed)) {
      if (typeof b64 === 'string') {
        const buf = Buffer.from(b64, 'base64');
        if (buf.length === 32) {
          map.set(kid, createKek(kid, buf));
        }
      }
    }
  } catch (err) {
    throw new Error(`Failed to load TRACE_KEKS: ${(err as Error).message}`);
  }
  return map;
}

export function unwrapKey(wrapped: Buffer, kid: string, keksMap?: Map<string, Kek>): Buffer {
  const keks = keksMap ?? loadKeks();
  const kek = keks.get(kid);
  if (!kek) {
    throw new AppError(500, 'KEK_NOT_FOUND', `Key encryption key '${kid}' not found`);
  }
  return kek.unwrap(wrapped);
}

// ─── Sealing and Opening Traces ──────────────────────────────────────────────

export function extractEnvelopeAadBytes(envelope: {
  kind: string;
  schemaVersion: number;
  alg: string;
  kid: string;
  plaintextHash: string;
  public: TracePublicPart;
}): Buffer {
  return canonicalBytesStrict({
    kind: envelope.kind,
    schemaVersion: envelope.schemaVersion,
    alg: envelope.alg,
    kid: envelope.kid,
    plaintextHash: envelope.plaintextHash,
    public: envelope.public,
  });
}

export function sealTrace(
  plaintext: Buffer,
  publicPart: TracePublicPart,
  kek: Kek,
): SealedTrace {
  const plaintextHash = sha256Hex(plaintext);
  const dataKey = crypto.randomBytes(32);
  const nonce = crypto.randomBytes(24);

  const header = {
    kind: 'oracledesk.trace.enc' as const,
    schemaVersion: 1 as const,
    alg: 'XChaCha20-Poly1305' as const,
    kid: kek.kid,
    plaintextHash,
    public: publicPart,
  };

  const aad = extractEnvelopeAadBytes(header);
  const ciphertextWithTag = xchacha20poly1305Encrypt(dataKey, nonce, plaintext, aad);

  const envelope: TraceEnvelopeV1 = {
    ...header,
    nonce: nonce.toString('base64'),
    ciphertext: ciphertextWithTag.toString('base64'),
  };

  const bytes = canonicalBytesStrict(envelope);
  const wrappedKey = kek.wrap(dataKey);

  return {
    envelope,
    bytes,
    plaintextHash,
    wrappedKey,
    kid: kek.kid,
  };
}

export function openTrace(envelope: TraceEnvelopeV1, dataKey: Buffer): Buffer {
  if (envelope.kind !== 'oracledesk.trace.enc') {
    throw new AppError(400, 'INVALID_ENVELOPE_KIND', `Unsupported envelope kind '${envelope.kind}'`);
  }
  if (envelope.schemaVersion !== 1) {
    throw new AppError(400, 'UNSUPPORTED_SCHEMA_VERSION', `Unsupported schemaVersion '${envelope.schemaVersion}'`);
  }
  if (envelope.alg !== 'XChaCha20-Poly1305') {
    throw new AppError(400, 'UNSUPPORTED_CIPHER_ALG', `Unsupported alg '${envelope.alg}'`);
  }

  const nonce = Buffer.from(envelope.nonce, 'base64');
  const ciphertextWithTag = Buffer.from(envelope.ciphertext, 'base64');

  const aad = extractEnvelopeAadBytes(envelope);
  let decrypted: Buffer;
  try {
    decrypted = xchacha20poly1305Decrypt(dataKey, nonce, ciphertextWithTag, aad);
  } catch (err) {
    throw new AppError(400, 'AUTHENTICATION_FAILED', 'Failed to decrypt trace envelope: AEAD verification failed');
  }

  const computedHash = sha256Hex(decrypted);
  if (computedHash !== envelope.plaintextHash) {
    throw new AppError(400, 'TRACE_HASH_MISMATCH', 'Plaintext hash does not match committed hash');
  }

  return decrypted;
}
