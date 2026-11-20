/**
 * SEP-7 transaction URI builder and verifier (#270).
 *
 * Implements the exact SEP-7 URI signing payload:
 *   35 zero bytes || 0x04 || "stellar.sep.7 - URI Scheme" || uriWithoutSignature
 *
 * Parameters are emitted in a fixed canonical order with `signature` last.
 * Callers must treat the returned URI as opaque — re-encoding query parameters
 * breaks the Ed25519 signature.
 */
import crypto from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';

export const SEP7_URI_PREFIX = 'stellar.sep.7 - URI Scheme';
export const SEP7_MSG_MAX_LENGTH = 300;
/** QR codes degrade rapidly above ~2,900 bytes; signal UI to fall back to deep links. */
export const SEP7_QR_MAX_BYTES = 2900;

export interface BuildTxUriParams {
  xdr: string;
  callback: string;
  pubkey: string;
  msg: string;
  networkPassphrase: string;
  originDomain: string;
}

/**
 * Computes the exact byte payload signed under SEP-7:
 * 35×0x00 || 0x04 || UTF-8("stellar.sep.7 - URI Scheme") || UTF-8(uriWithoutSignature).
 */
export function sep7Payload(uriWithoutSignature: string): Buffer {
  const zeroPrefix = Buffer.alloc(35, 0);
  const typeByte = Buffer.from([0x04]);
  const schemePrefix = Buffer.from(SEP7_URI_PREFIX, 'utf8');
  const uriBytes = Buffer.from(uriWithoutSignature, 'utf8');
  return Buffer.concat([zeroPrefix, typeByte, schemePrefix, uriBytes]);
}

/**
 * Truncates human-readable message to 300 characters before URL encoding,
 * per SEP-7 limits.
 */
export function truncateSep7Message(msg: string): string {
  const trimmed = msg.trim();
  if (trimmed.length <= SEP7_MSG_MAX_LENGTH) return trimmed;
  return trimmed.slice(0, SEP7_MSG_MAX_LENGTH);
}

/**
 * Builds and signs a `web+stellar:tx?...&signature=...` SEP-7 URI in fixed
 * parameter order with `signature` last.
 */
export function buildTxUri(params: BuildTxUriParams, key: Keypair): string {
  const callbackValue = params.callback.startsWith('url:')
    ? params.callback
    : `url:${params.callback}`;
  const truncatedMsg = truncateSep7Message(params.msg);

  const pairs: Array<[string, string]> = [
    ['xdr', params.xdr],
    ['callback', callbackValue],
    ['pubkey', params.pubkey],
    ['msg', truncatedMsg],
    ['network_passphrase', params.networkPassphrase],
    ['origin_domain', params.originDomain],
  ];

  const query = pairs
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  const unsignedUri = `web+stellar:tx?${query}`;
  const signature = key.sign(sep7Payload(unsignedUri)).toString('base64');
  return `${unsignedUri}&signature=${encodeURIComponent(signature)}`;
}

/**
 * Verifies a signed SEP-7 URI against the published `URI_REQUEST_SIGNING_KEY`
 * without re-encoding any parameters.
 */
export function verifyTxUri(uri: string, pubkey: string): boolean {
  const marker = '&signature=';
  const idx = uri.lastIndexOf(marker);
  if (idx === -1) return false;
  const unsignedUri = uri.slice(0, idx);
  const encodedSig = uri.slice(idx + marker.length);
  if (!encodedSig || encodedSig.includes('&')) return false;
  try {
    const sigBytes = Buffer.from(decodeURIComponent(encodedSig), 'base64');
    return Keypair.fromPublicKey(pubkey).verify(sep7Payload(unsignedUri), sigBytes);
  } catch {
    return false;
  }
}

/** Generates a 256-bit cryptographically random single-use callback token. */
export function generateSep7Token(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/** SHA-256 hex digest stored in `sep7_requests.tokenHash`; raw tokens are never stored. */
export function hashSep7Token(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export function isQrTooLarge(uri: string): boolean {
  return Buffer.byteLength(uri, 'utf8') > SEP7_QR_MAX_BYTES;
}

/** Renders the minimal SEP-1 `stellar.toml` body needed by SEP-7 wallets. */
export function renderSep7StellarToml(networkPassphrase: string, signingSecret: string): string {
  const signingKey = Keypair.fromSecret(signingSecret).publicKey();
  return [
    `NETWORK_PASSPHRASE="${networkPassphrase}"`,
    `URI_REQUEST_SIGNING_KEY="${signingKey}"`,
    '',
  ].join('\n');
}
