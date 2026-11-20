/**
 * Domain-separated Ed25519 trace signing & verification (#273).
 *
 * Byte-for-byte compatible with `contracts/reasoning-registry/src/lib.rs`:
 * - `keyBindMessage`: `"oracledesk-agent-key-v1" || sha256(passphrase) || XDR(registry) || XDR(agent) || publicKey`
 * - `traceAttestationMessage`: `"oracledesk-trace-v1" || sha256(passphrase) || XDR(registry) || XDR(agent) || be64(marketId) || actionTagByte [|| XDR(Symbol)] || traceHash`
 *
 * The raw seed buffer is zeroed automatically when `TRACE_SIGNING_KEY` rotates.
 */
import crypto from 'node:crypto';
import { Address, Keypair, StrKey, xdr } from '@stellar/stellar-sdk';
import { config } from '../config';
import { onSecretChange, secret } from '../config/secrets';

export const KEY_BIND_DOMAIN = 'oracledesk-agent-key-v1';
export const TRACE_ATTESTATION_DOMAIN = 'oracledesk-trace-v1';

export type ChainTraceAction =
  | { kind: 'CreateMarket' }
  | { kind: 'ProposeMarket' }
  | { kind: 'Buy' }
  | { kind: 'Sell' }
  | { kind: 'Skip' }
  | { kind: 'Redeem' }
  | { kind: 'ClaimRemainder' }
  | { kind: 'Resolve' }
  | { kind: 'Other'; symbol: string };

const ACTION_TAG_BYTE: Record<ChainTraceAction['kind'], number> = {
  CreateMarket: 0,
  ProposeMarket: 1,
  Buy: 2,
  Sell: 3,
  Skip: 4,
  Redeem: 5,
  ClaimRemainder: 6,
  Resolve: 7,
  Other: 8,
};

export function encodeActionBytes(action: ChainTraceAction): Buffer {
  const tag = Buffer.from([ACTION_TAG_BYTE[action.kind]]);
  if (action.kind === 'Other') {
    const symXdr = xdr.ScVal.scvSymbol(action.symbol).toXDR();
    return Buffer.concat([tag, symXdr]);
  }
  return tag;
}

export function networkId(networkPassphrase: string): Buffer {
  return crypto.createHash('sha256').update(networkPassphrase, 'utf8').digest();
}

export function encodeAddressXdr(address: string): Buffer {
  return new Address(address).toScVal().toXDR();
}

/**
 * Exact byte payload signed by a new trace signing key as proof of possession
 * for `reasoning_registry.add_signing_key`.
 */
export function keyBindMessage(params: {
  networkPassphrase: string;
  registry: string;
  agent: string;
  publicKey: Buffer;
}): Buffer {
  if (params.publicKey.length !== 32) {
    throw new Error(`Expected 32-byte Ed25519 public key, got ${params.publicKey.length} bytes`);
  }
  return Buffer.concat([
    Buffer.from(KEY_BIND_DOMAIN, 'utf8'),
    networkId(params.networkPassphrase),
    encodeAddressXdr(params.registry),
    encodeAddressXdr(params.agent),
    params.publicKey,
  ]);
}

/**
 * Exact byte payload signed for `publish_trace_signed` / `publish_chained_trace_signed`.
 */
export function traceAttestationMessage(params: {
  networkPassphrase: string;
  registry: string;
  agent: string;
  marketId: bigint;
  action: ChainTraceAction;
  traceHash: Buffer;
}): Buffer {
  if (params.traceHash.length !== 32) {
    throw new Error(`Expected 32-byte trace hash, got ${params.traceHash.length} bytes`);
  }
  const marketIdBuf = Buffer.alloc(8);
  marketIdBuf.writeBigUInt64BE(params.marketId, 0);
  return Buffer.concat([
    Buffer.from(TRACE_ATTESTATION_DOMAIN, 'utf8'),
    networkId(params.networkPassphrase),
    encodeAddressXdr(params.registry),
    encodeAddressXdr(params.agent),
    marketIdBuf,
    encodeActionBytes(params.action),
    params.traceHash,
  ]);
}

/**
 * Parses `TRACE_SIGNING_KEY` from either a Stellar `S...` secret seed or a
 * 64-character hex string representing a 32-byte Ed25519 raw seed.
 */
export function parseTraceSigningSeed(raw: string): Buffer {
  const trimmed = raw.trim();
  if (StrKey.isValidEd25519SecretSeed(trimmed)) {
    return Buffer.from(StrKey.decodeEd25519SecretSeed(trimmed));
  }
  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }
  throw new Error('TRACE_SIGNING_KEY must be a Stellar S… secret seed or 64-char hex seed');
}

export function deriveTraceSigningPublicKeyHex(rawSeed: string): string {
  const seed = parseTraceSigningSeed(rawSeed);
  try {
    const kp = Keypair.fromRawEd25519Seed(seed);
    return Buffer.from(kp.rawPublicKey()).toString('hex');
  } finally {
    seed.fill(0);
  }
}

export interface TraceSigner {
  readonly publicKey: Buffer;
  readonly publicKeyHex: string;
  sign(msg: Buffer): Buffer;
}

let cachedSeedBuf: Buffer | null = null;
let cachedRawSource = '';
let rotationListenerRegistered = false;

function zeroCachedSeed(): void {
  if (cachedSeedBuf) {
    cachedSeedBuf.fill(0);
    cachedSeedBuf = null;
  }
  cachedRawSource = '';
}

function ensureRotationListener(): void {
  if (rotationListenerRegistered) return;
  rotationListenerRegistered = true;
  onSecretChange('TRACE_SIGNING_KEY', () => {
    zeroCachedSeed();
  });
}

function resolveTraceSigningKeyRaw(): string {
  try {
    return secret('TRACE_SIGNING_KEY') || config.TRACE_SIGNING_KEY;
  } catch {
    return config.TRACE_SIGNING_KEY;
  }
}

/**
 * Returns the active Ed25519 trace signer. Automatically zeroes retired raw
 * seed buffers when `TRACE_SIGNING_KEY` rotates in the secret store.
 */
export function traceSigner(overrideSeed?: string): TraceSigner {
  ensureRotationListener();
  const raw = overrideSeed ?? resolveTraceSigningKeyRaw();
  if (!raw) {
    throw new Error('TRACE_SIGNING_KEY is not configured');
  }

  let seed: Buffer;
  if (overrideSeed) {
    seed = parseTraceSigningSeed(raw);
  } else {
    if (!cachedSeedBuf || cachedRawSource !== raw) {
      zeroCachedSeed();
      cachedSeedBuf = parseTraceSigningSeed(raw);
      cachedRawSource = raw;
    }
    seed = cachedSeedBuf;
  }

  const kp = Keypair.fromRawEd25519Seed(seed);
  const publicKey = Buffer.from(kp.rawPublicKey());
  return {
    publicKey,
    publicKeyHex: publicKey.toString('hex'),
    sign(msg: Buffer): Buffer {
      return Buffer.from(kp.sign(msg));
    },
  };
}

/** Verifies an Ed25519 trace attestation signature locally without RPC. */
export function verifyTraceSignatureLocal(
  publicKeyHex: string,
  message: Buffer,
  signature: Buffer,
): boolean {
  if (!/^[0-9a-f]{64}$/i.test(publicKeyHex) || signature.length !== 64) {
    return false;
  }
  try {
    const pubKey = StrKey.encodeEd25519PublicKey(Buffer.from(publicKeyHex, 'hex'));
    return Keypair.fromPublicKey(pubKey).verify(message, signature);
  } catch {
    return false;
  }
}

export function resetTraceSignerCacheForTests(): void {
  zeroCachedSeed();
}
