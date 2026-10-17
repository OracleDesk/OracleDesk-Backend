import crypto from 'crypto';

/**
 * Deterministic JSON: object keys sorted recursively, no whitespace, bigints
 * as decimal strings. Same rules as agents/core/trace.ts `canonicalize` in
 * the contracts repo, so a trace hashes the same on both sides.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) sorted[key] = sortKeysDeep(v);
    }
    return sorted;
  }
  return value;
}

/**
 * Strict canonical JSON: throws on undefined, functions, symbols, non-finite numbers and Date.
 * Enforces explicit nulls and deterministic serialization.
 */
export function canonicalJsonStrict(value: unknown): string {
  function validateAndSort(val: unknown, path = '$'): unknown {
    if (val === undefined) {
      throw new TypeError(`canonicalJsonStrict: undefined encountered at ${path}`);
    }
    if (typeof val === 'function' || typeof val === 'symbol') {
      throw new TypeError(`canonicalJsonStrict: disallowed ${typeof val} encountered at ${path}`);
    }
    if (typeof val === 'number' && !Number.isFinite(val)) {
      throw new TypeError(`canonicalJsonStrict: non-finite number (${val}) encountered at ${path}`);
    }
    if (val instanceof Date) {
      throw new TypeError(`canonicalJsonStrict: Date instance encountered at ${path}; convert to ISO string explicitly`);
    }
    if (typeof val === 'bigint') {
      return val.toString();
    }
    if (Array.isArray(val)) {
      return val.map((item, idx) => validateAndSort(item, `${path}[${idx}]`));
    }
    if (val !== null && typeof val === 'object') {
      const sorted: Record<string, unknown> = {};
      const keys = Object.keys(val as Record<string, unknown>).sort();
      for (const key of keys) {
        sorted[key] = validateAndSort((val as Record<string, unknown>)[key], `${path}.${key}`);
      }
      return sorted;
    }
    return val;
  }

  const sorted = validateAndSort(value);
  const serialized = JSON.stringify(sorted);

  // Round-trip verification: parsing and re-serializing must produce identical output
  const reparsed = JSON.parse(serialized);
  const reSerialized = JSON.stringify(validateAndSort(reparsed));
  if (serialized !== reSerialized) {
    throw new Error('canonicalJsonStrict: round-trip serialization mismatch');
  }

  return serialized;
}

/** Canonical bytes for a JSON document. Hash and upload these exact bytes. */
export function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(canonicalJson(value), 'utf8');
}

export function canonicalBytesStrict(value: unknown): Buffer {
  return Buffer.from(canonicalJsonStrict(value), 'utf8');
}

export function sha256Hex(bytes: Uint8Array | string): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

/** Same check as x402/trace-verification.ts in the contracts repo. */
export function verifyTraceHash(content: Uint8Array, expectedHash: string): boolean {
  const normalized = expectedHash.toLowerCase().replace(/^0x/, '');
  return /^[0-9a-f]{64}$/.test(normalized) && sha256Hex(content) === normalized;
}
