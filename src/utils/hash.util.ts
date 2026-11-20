import crypto from 'crypto';

/**
 * Deterministic JSON: object keys sorted recursively, no whitespace, bigints
 * as decimal strings. Same rules as agents/core/trace.ts `canonicalize` in
 * the contracts repo, so a trace hashes the same on both sides.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

export interface JsonBounds {
  maxDepth?: number;
  maxNodes?: number;
  maxStringBytes?: number;
  maxBytes?: number;
}

export class JsonBoundsError extends Error {
  constructor(public readonly reason: string) {
    super(`JSON exceeds safety limits: ${reason}`);
    this.name = 'JsonBoundsError';
  }
}

/** Guard untrusted parsed JSON before recursive canonicalisation or hashing. */
export function canonicalJsonBounded(value: unknown, bounds: JsonBounds = {}): string {
  const maxDepth = bounds.maxDepth ?? 64;
  const maxNodes = bounds.maxNodes ?? 10_000;
  const maxStringBytes = bounds.maxStringBytes ?? 1_048_576;
  const maxBytes = bounds.maxBytes ?? 1_048_576;
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const current = stack.pop()!;
    nodes++;
    if (nodes > maxNodes) throw new JsonBoundsError('node count');
    if (current.depth > maxDepth) throw new JsonBoundsError('nesting depth');
    if (typeof current.value === 'string' && Buffer.byteLength(current.value, 'utf8') > maxStringBytes) {
      throw new JsonBoundsError('string length');
    }
    if (current.value !== null && typeof current.value === 'object') {
      for (const child of Object.values(current.value as Record<string, unknown>)) {
        stack.push({ value: child, depth: current.depth + 1 });
      }
    }
  }
  const result = canonicalJson(value);
  if (Buffer.byteLength(result, 'utf8') > maxBytes) throw new JsonBoundsError('encoded size');
  return result;
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
 * Thrown by {@link assertPlainJson} for values the contracts repo's
 * `canonicalize` (agents/core/trace.ts) would encode differently from
 * `canonicalJson`, which would make the pinned bytes fail the x402 service's
 * on-chain hash check.
 */
export class NonPlainJsonError extends Error {
  constructor(public readonly path: string, public readonly kind: string) {
    super(`Cannot canonicalise ${kind} at ${path}: only plain JSON values may be pinned`);
    this.name = 'NonPlainJsonError';
  }
}

/**
 * Rejects anything that is not a plain JSON value (null, boolean, string,
 * number, bigint, arrays and plain objects). In particular `Date`, `Map`,
 * `Set`, class instances and functions are refused: the backend would turn a
 * `Date` into an ISO string while the contracts canonicaliser emits `{}`, so
 * the two sides would hash different bytes. Format such values before they
 * reach the document (e.g. `date.toISOString()`).
 */
export function assertPlainJson(value: unknown, path = '$'): void {
  switch (typeof value) {
    case 'string':
    case 'boolean':
    case 'number':
    case 'bigint':
    case 'undefined':
      return;
    case 'object': {
      if (value === null) return;
      if (Array.isArray(value)) {
        value.forEach((v, i) => assertPlainJson(v, `${path}[${i}]`));
        return;
      }
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        throw new NonPlainJsonError(path, (value as object).constructor?.name ?? 'non-plain object');
      }
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        assertPlainJson(v, `${path}.${k}`);
      }
      return;
    }
    default:
      throw new NonPlainJsonError(path, typeof value);
  }
}

/**
 * Stricter than {@link assertPlainJson}, for blocks that are embedded in a
 * pinned document by hand (#66): additionally rejects `undefined` (canonicalJson
 * would drop the key silently) and non-finite numbers (JSON turns them into
 * null). Key order does not matter; canonicalJson sorts.
 */
export function assertCanonicalSafe(value: unknown, path = '$'): void {
  if (value === undefined) throw new NonPlainJsonError(path, 'undefined');
  if (typeof value === 'number' && !Number.isFinite(value)) throw new NonPlainJsonError(path, 'non-finite number');
  assertPlainJson(value, path);
  if (Array.isArray(value)) value.forEach((v, i) => assertCanonicalSafe(v, `${path}[${i}]`));
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) assertCanonicalSafe(v, `${path}.${k}`);
  }
}

/** Canonical bytes for a JSON document. Hash and upload these exact bytes. */
export function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(canonicalJson(value), 'utf8');
}

export function canonicalBytesStrict(value: unknown, opts?: CanonicalStrictOptions): Buffer {
  return Buffer.from(canonicalJsonStrict(value, opts), 'utf8');
}

/**
 * Reasons `canonicalJsonStrict` can refuse an input. The strict profile
 * accepts a value or rejects it with the path and the reason — it never
 * silently normalises, so strict and non-strict bytes must agree for any
 * accepted value.
 */
export type CanonicalStrictReason =
  | 'undefined'
  | 'non-finite'
  | 'unsafe-integer'
  | 'negative-zero'
  | 'non-plain'
  | 'lone-surrogate'
  | 'bigint-not-allowed';

export class CanonicalStrictError extends Error {
  constructor(public readonly path: string, public readonly reason: CanonicalStrictReason) {
    super(`canonicalJsonStrict rejected ${reason} at ${path}`);
    this.name = 'CanonicalStrictError';
  }
}

export interface CanonicalStrictOptions {
  /** When true, bigint is allowed and serialised as a decimal string (same bytes as `canonicalJson`). */
  allowBigint?: boolean;
}

/**
 * Lone UTF-16 surrogate scan. `JSON.stringify` escapes lone surrogates, but
 * other runtimes (notably Rust `serde_json`) emit the Unicode replacement
 * character, so the two sides would hash different bytes.
 */
function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function assertCanonicalStrict(value: unknown, path: string, opts: CanonicalStrictOptions): void {
  switch (typeof value) {
    case 'undefined':
      throw new CanonicalStrictError(path, 'undefined');
    case 'number': {
      if (!Number.isFinite(value)) throw new CanonicalStrictError(path, 'non-finite');
      // -0 serialises as "0" and loses sign; reject so bytes never depend on sign.
      if (Object.is(value, -0)) throw new CanonicalStrictError(path, 'negative-zero');
      if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
        throw new CanonicalStrictError(path, 'unsafe-integer');
      }
      return;
    }
    case 'string':
      if (hasLoneSurrogate(value)) throw new CanonicalStrictError(path, 'lone-surrogate');
      return;
    case 'boolean':
      return;
    case 'bigint':
      if (!opts.allowBigint) throw new CanonicalStrictError(path, 'bigint-not-allowed');
      return;
    case 'object': {
      if (value === null) return;
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          // Array "holes" come back as undefined; reject so canonical bytes never
          // depend on whether the hole was explicit.
          if (!(i in value)) throw new CanonicalStrictError(`${path}[${i}]`, 'undefined');
          assertCanonicalStrict(value[i], `${path}[${i}]`, opts);
        }
        return;
      }
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        throw new CanonicalStrictError(path, 'non-plain');
      }
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        assertCanonicalStrict(v, `${path}.${k}`, opts);
      }
      return;
    }
    default:
      throw new CanonicalStrictError(path, 'non-plain');
  }
}

/**
 * Documented strict profile over `canonicalJson`. For every accepted value
 * the output equals `canonicalJson(value)`, so switching to the strict
 * profile never changes pinned bytes. Rejections throw
 * {@link CanonicalStrictError}, carrying the JSON-pointer-ish `path` that
 * failed and a machine-readable `reason`.
 *
 * The rejection list is: `undefined` members (including array holes),
 * `NaN`/`±Infinity`, `-0`, integers outside `Number.isSafeInteger` (non-
 * integers are allowed — traces carry probabilities), class instances
 * (Date, Map, Set, user classes, functions), strings containing lone UTF-16
 * surrogates, and bigint unless `allowBigint` is set. Numbers that
 * canonicalise as `Number::toString` are shared between both sides.
 */
export function canonicalJsonStrict(value: unknown, opts: CanonicalStrictOptions = {}): string {
  assertCanonicalStrict(value, '$', opts);
  return canonicalJson(value);
}

/**
 * Tiny streaming pass that rejects duplicate keys at the raw-bytes level.
 * `JSON.parse` keeps the last one silently, which would let two different
 * byte strings parse to the same object — breaking "these bytes are
 * canonical" claims.
 */
function assertNoDuplicateKeys(bytes: Buffer): void {
  const text = bytes.toString('utf8');
  const stack: Array<Set<string>> = [];
  let i = 0;
  while (i < text.length) {
    const ch = text.charCodeAt(i);
    if (ch === 0x7b /* { */) {
      stack.push(new Set());
      i++;
      continue;
    }
    if (ch === 0x7d /* } */) {
      stack.pop();
      i++;
      continue;
    }
    if (ch === 0x22 /* " */) {
      // Walk the string literal, honouring escapes.
      let j = i + 1;
      while (j < text.length) {
        const c = text.charCodeAt(j);
        if (c === 0x5c /* \ */) {
          j += 2;
          continue;
        }
        if (c === 0x22) break;
        j++;
      }
      const raw = text.slice(i, j + 1);
      i = j + 1;
      // A key is followed, after optional whitespace, by ':'.
      let k = i;
      while (k < text.length && /\s/.test(text[k])) k++;
      if (text[k] === ':' && stack.length > 0) {
        const key = JSON.parse(raw) as string;
        const top = stack[stack.length - 1];
        if (top.has(key)) {
          throw new CanonicalStrictError(`$.${key}`, 'non-plain');
        }
        top.add(key);
      }
      continue;
    }
    i++;
  }
}

/**
 * Verifier helper: asserts that `bytes` is a strict-canonical encoding of
 * the JSON value they decode to. Rejects duplicate keys at the byte level
 * and non-canonical ordering/formatting. Returns the parsed value on
 * success. Verifiers can use it to say "these bytes are canonical".
 */
export function parseCanonicalStrict(bytes: Buffer, opts: CanonicalStrictOptions = {}): unknown {
  assertNoDuplicateKeys(bytes);
  const parsed = JSON.parse(bytes.toString('utf8'));
  const reCanonical = canonicalJsonStrict(parsed, opts);
  if (reCanonical !== bytes.toString('utf8')) {
    throw new CanonicalStrictError('$', 'non-plain');
  }
  return parsed;
}

export function sha256Hex(bytes: Uint8Array | string): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

/** Same check as x402/trace-verification.ts in the contracts repo. */
export function verifyTraceHash(content: Uint8Array, expectedHash: string): boolean {
  const normalized = expectedHash.toLowerCase().replace(/^0x/, '');
  return /^[0-9a-f]{64}$/.test(normalized) && sha256Hex(content) === normalized;
}
