/**
 * Resolution specs and their commitment hash (ADR 0001 / ADR 0004).
 *
 * Legacy scheme: sha256(XDR(ResolutionSpec)) — unchanged.
 * V2 scheme (ADR 0004): sha256("oracledesk:resolution-spec" || XDR(ResolutionSpecV2))
 * Scaled scheme:        sha256("oracledesk:scaled-price-spec" || XDR(ScaledPriceConfig))
 * TWAP scheme:          sha256("oracledesk:price-twap-spec" || XDR(TwapConfig))
 *
 * This must match contracts/oracledesk-stellar/scripts/spec-hash byte for
 * byte; tests/resolution-spec.test.ts checks it against fixtures produced
 * by that tool.
 */
import crypto from 'crypto';
import { StrKey, xdr } from '@stellar/stellar-sdk';
import { Client as ResolverClient } from '../generated/resolver';
import type { PriceConfig, SignerConfig } from '../generated/resolver';

export type PriceDirectionName = 'Above' | 'AtOrAbove' | 'Below' | 'AtOrBelow';

/** JSON-safe form, as stored in the database and returned by the API. */
export type ResolutionSpecJson =
  | {
      kind: 'price';
      reflector: string;
      asset: { kind: 'stellar'; address: string } | { kind: 'other'; symbol: string };
      threshold: string; // i128, decimal string
      direction: PriceDirectionName;
      maxStaleness: number; // seconds
    }
  | {
      kind: 'signers';
      signers: string[];
      threshold: number;
      disputeWindow: number; // seconds
    }
  | {
      /** Decimal-scaled price spec (ADR 0004 — standalone domain-tagged hash, not a V2 envelope). */
      kind: 'price_scaled';
      reflector: string;
      asset: { kind: 'stellar'; address: string } | { kind: 'other'; symbol: string };
      threshold: string;   // i128 decimal string
      thresholdDecimals: number;
      direction: PriceDirectionName;
      maxStaleness: number;
    }
  | {
      /** TWAP price spec (ADR 0004 — standalone domain-tagged hash, not a V2 envelope). */
      kind: 'price_twap';
      reflector: string;
      asset: { kind: 'stellar'; address: string } | { kind: 'other'; symbol: string };
      threshold: string;   // i128 decimal string
      direction: PriceDirectionName;
      window: number;      // seconds
      minSamples: number;
      maxGap: number;      // seconds
    };

// ─── Commitment scheme ────────────────────────────────────────────────────────

/** Which hash formula was used to produce a market's resolutionHash. */
export type CommitmentScheme = 'legacy' | 'v2' | 'scaled' | 'twap';

export interface StoredCommitment {
  scheme: CommitmentScheme;
  rule: ResolutionSpecJson;
  /** Present only for scheme = 'v2'. */
  v2?: {
    /** sha256(STELLAR_NETWORK_PASSPHRASE) as hex. */
    networkIdHex: string;
    /** C… contract address of the market-core. */
    marketCore: string;
    /** 32-byte random salt as hex. */
    saltHex: string;
  };
}

/** Thrown when a market row cannot be decoded into a StoredCommitment. */
export class SpecDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpecDecodeError';
  }
}

// The spec is all we need; the contract id and RPC are never used.
const resolverSpec = new ResolverClient({
  contractId: StrKey.encodeContract(Buffer.alloc(32)),
  rpcUrl: 'http://127.0.0.1:0',
  networkPassphrase: 'unused',
  allowHttp: true,
}).spec;

const udt = (name: string) => xdr.ScSpecTypeDef.scSpecTypeUdt(new xdr.ScSpecTypeUdt({ name }));

export function toPriceConfig(spec: Extract<ResolutionSpecJson, { kind: 'price' }>): PriceConfig {
  return {
    reflector: spec.reflector,
    asset:
      spec.asset.kind === 'stellar'
        ? { tag: 'Stellar', values: [spec.asset.address] as const }
        : { tag: 'Other', values: [spec.asset.symbol] as const },
    threshold: BigInt(spec.threshold),
    direction: { tag: spec.direction, values: undefined },
    max_staleness: BigInt(spec.maxStaleness),
  };
}

export function toSignerConfig(spec: Extract<ResolutionSpecJson, { kind: 'signers' }>): SignerConfig {
  return {
    signers: spec.signers,
    threshold: spec.threshold,
    dispute_window: BigInt(spec.disputeWindow),
  };
}

export function resolutionSpecScVal(spec: ResolutionSpecJson): xdr.ScVal {
  validateResolutionSpec(spec);
  // price_scaled and price_twap are not ResolutionSpec variants: they are
  // hashed on their own under a domain tag (see commitmentHash).
  if (spec.kind === 'price_scaled' || spec.kind === 'price_twap') {
    throw new SpecDecodeError(`${spec.kind} has no ResolutionSpec encoding; use commitmentHash`);
  }
  const [variant, inner] =
    spec.kind === 'price'
      ? ['Price', resolverSpec.nativeToScVal(toPriceConfig(spec), udt('PriceConfig'))]
      : ['Signers', resolverSpec.nativeToScVal(toSignerConfig(spec), udt('SignerConfig'))];
  return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(variant), inner]);
}

/** sha256(XDR(ResolutionSpec)) as 32 bytes. Legacy scheme only. */
export function resolutionHash(spec: ResolutionSpecJson): Buffer {
  return crypto.createHash('sha256').update(resolutionSpecScVal(spec).toXDR()).digest();
}

// ─── ADR 0004 domain-tagged hashers ──────────────────────────────────────────

const DOMAINS = {
  v2:     Buffer.from('oracledesk:resolution-spec',   'ascii'),
  scaled: Buffer.from('oracledesk:scaled-price-spec', 'ascii'),
  twap:   Buffer.from('oracledesk:price-twap-spec',   'ascii'),
} as const;

function sha256(...parts: Buffer[]): Buffer {
  const h = crypto.createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest();
}

/** Encode a ScaledPriceConfig as an ScVal (ScMap, fields sorted by name). */
function scaledPriceConfigScVal(spec: Extract<ResolutionSpecJson, { kind: 'price_scaled' }>): xdr.ScVal {
  // ScMap entries are sorted by key symbol name, matching the #[contracttype] encoding.
  const asset =
    spec.asset.kind === 'stellar'
      ? xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Stellar'), xdr.ScVal.scvString(spec.asset.address)])
      : xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Other'), xdr.ScVal.scvString(spec.asset.symbol)]);
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('asset'),              val: asset }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('direction'),          val: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(spec.direction)]) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('max_staleness'),      val: xdr.ScVal.scvU64(xdr.Uint64.fromString(String(spec.maxStaleness))) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('reflector'),          val: xdr.ScVal.scvString(spec.reflector) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('threshold'),          val: xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: xdr.Int64.fromString('0'), lo: xdr.Uint64.fromString(spec.threshold.replace('-', '')) })) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('threshold_decimals'), val: xdr.ScVal.scvU32(spec.thresholdDecimals) }),
  ]);
}

/** Encode a TwapConfig as an ScVal. */
function twapConfigScVal(spec: Extract<ResolutionSpecJson, { kind: 'price_twap' }>): xdr.ScVal {
  const asset =
    spec.asset.kind === 'stellar'
      ? xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Stellar'), xdr.ScVal.scvString(spec.asset.address)])
      : xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Other'), xdr.ScVal.scvString(spec.asset.symbol)]);
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('asset'),       val: asset }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('direction'),   val: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(spec.direction)]) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('max_gap'),     val: xdr.ScVal.scvU64(xdr.Uint64.fromString(String(spec.maxGap))) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('min_samples'), val: xdr.ScVal.scvU32(spec.minSamples) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('reflector'),   val: xdr.ScVal.scvString(spec.reflector) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('threshold'),   val: xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: xdr.Int64.fromString('0'), lo: xdr.Uint64.fromString(spec.threshold.replace('-', '')) })) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('window'),      val: xdr.ScVal.scvU64(xdr.Uint64.fromString(String(spec.window))) }),
  ]);
}

/** Encode a ResolutionSpecV2 envelope as an ScVal. */
function specV2ScVal(c: StoredCommitment & { v2: NonNullable<StoredCommitment['v2']> }): xdr.ScVal {
  const rule = resolutionSpecScVal(c.rule);
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('market_core'), val: xdr.ScVal.scvString(c.v2.marketCore) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('network_id'),  val: xdr.ScVal.scvBytes(Buffer.from(c.v2.networkIdHex, 'hex')) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('rule'),        val: rule }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('salt'),        val: xdr.ScVal.scvBytes(Buffer.from(c.v2.saltHex, 'hex')) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('version'),     val: xdr.ScVal.scvU32(2) }),
  ]);
}

/**
 * Compute the on-chain commitment hash for a stored commitment, dispatching on
 * scheme. All four schemes produce a 32-byte Buffer.
 *
 * Legacy markets: sha256(XDR(ResolutionSpec)) — unchanged.
 * V2:             sha256("oracledesk:resolution-spec" || XDR(ResolutionSpecV2))
 * Scaled:         sha256("oracledesk:scaled-price-spec" || XDR(ScaledPriceConfig))
 * TWAP:           sha256("oracledesk:price-twap-spec" || XDR(TwapConfig))
 */
export function commitmentHash(c: StoredCommitment): Buffer {
  switch (c.scheme) {
    case 'legacy':
      return sha256(resolutionSpecScVal(c.rule).toXDR());

    case 'v2': {
      if (!c.v2) throw new SpecDecodeError('V2 commitment missing v2 envelope fields');
      if (Buffer.from(c.v2.saltHex, 'hex').every((b) => b === 0)) {
        throw new SpecDecodeError('V2 salt must not be all-zero');
      }
      if (c.rule.kind === 'price_scaled' || c.rule.kind === 'price_twap') {
        throw new SpecDecodeError('price_scaled and price_twap use their own domain-tagged hash, not the v2 envelope');
      }
      return sha256(DOMAINS.v2, specV2ScVal(c as StoredCommitment & { v2: NonNullable<StoredCommitment['v2']> }).toXDR());
    }

    case 'scaled': {
      if (c.rule.kind !== 'price_scaled') throw new SpecDecodeError('scaled scheme requires price_scaled rule');
      return sha256(DOMAINS.scaled, scaledPriceConfigScVal(c.rule).toXDR());
    }

    case 'twap': {
      if (c.rule.kind !== 'price_twap') throw new SpecDecodeError('twap scheme requires price_twap rule');
      return sha256(DOMAINS.twap, twapConfigScVal(c.rule).toXDR());
    }
  }
}

/**
 * Generate a cryptographically random 32-byte salt for V2 commitments.
 * Guarantees non-zero (re-draws on the astronomically unlikely all-zero result).
 */
export function generateSalt(): Buffer {
  for (;;) {
    const salt = crypto.randomBytes(32);
    if (!salt.every((b) => b === 0)) return salt;
  }
}

/**
 * Compute sha256(STELLAR_NETWORK_PASSPHRASE) as a hex string.
 * This is the network_id used in V2 commitments.
 */
export function networkIdHex(passphrase: string): string {
  return crypto.createHash('sha256').update(passphrase, 'utf8').digest('hex');
}

export interface ValidateResolutionSpecOptions {
  /**
   * Reveal-time validation (register_price_spec / register_signer_spec) applies
   * the resolver contract's own rules, which are stricter than hashing needs.
   * The contract rejects `threshold < 0` with InvalidConfig, but the spec-hash
   * fixtures include a negative price threshold, so that check is only applied
   * here, never while hashing.
   */
  forReveal?: boolean;
}

export function validateResolutionSpec(spec: ResolutionSpecJson, opts: ValidateResolutionSpecOptions = {}): void {
  const isAddress = (a: string) => StrKey.isValidEd25519PublicKey(a) || StrKey.isValidContract(a);
  if (spec.kind === 'signers') {
    if (spec.signers.length === 0 || !spec.signers.every(isAddress)) throw new Error('signers must be Stellar addresses');
    if (!Number.isInteger(spec.threshold) || spec.threshold < 1 || spec.threshold > spec.signers.length) {
      throw new Error('threshold must be between 1 and the number of signers');
    }
    if (!Number.isInteger(spec.disputeWindow) || spec.disputeWindow < 0) throw new Error('disputeWindow must be >= 0');
    return;
  }
  if (!StrKey.isValidContract(spec.reflector)) throw new Error('reflector must be a C… contract id');
  if (spec.asset.kind === 'stellar' && !isAddress(spec.asset.address)) throw new Error('asset address is invalid');
  if (spec.asset.kind === 'other' && spec.asset.symbol.length === 0) throw new Error('asset symbol must not be empty');
  if (!/^-?\d+$/.test(spec.threshold)) throw new Error('threshold must be an integer string');
  if (spec.kind === 'price_twap') {
    if (!Number.isInteger(spec.window) || spec.window <= 0) throw new Error('window must be > 0');
    if (!Number.isInteger(spec.minSamples) || spec.minSamples < 1) throw new Error('minSamples must be >= 1');
    if (!Number.isInteger(spec.maxGap) || spec.maxGap <= 0) throw new Error('maxGap must be > 0');
  } else {
    if (spec.kind === 'price_scaled' && (!Number.isInteger(spec.thresholdDecimals) || spec.thresholdDecimals < 0)) {
      throw new Error('thresholdDecimals must be >= 0');
    }
    // The resolver contract rejects max_staleness == 0 with InvalidConfig, so a
    // market committed with 0 could never be revealed.
    if (!Number.isInteger(spec.maxStaleness) || spec.maxStaleness <= 0) throw new Error('maxStaleness must be > 0');
  }
  if (opts.forReveal && BigInt(spec.threshold) < 0n) {
    throw new Error('threshold must be >= 0 to reveal a price spec');
  }
}
