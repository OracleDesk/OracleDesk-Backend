// Config key lifecycle metadata and boot-time warnings (#243).
//
// Every key in `envSchema` is `active` unless listed in KEY_LIFECYCLE. A key
// is listed here when nothing outside src/config reads it:
//   - `reserved`:   a planned feature has not landed; setting it has no effect.
//   - `deprecated`: it will be removed after `removeAfter`. When `replacedBy`
//                   is set and the new key is unset, the old value is mapped
//                   across so existing deployments keep working for a release.
//
// This module must not import the logger (the logger imports config), so
// warnings go through console.warn.
import type { z } from 'zod';
import type { envObjectSchema } from './index';

export type EnvKey = keyof z.input<typeof envObjectSchema>;
export type KeyStatus = 'active' | 'deprecated' | 'reserved';

export interface KeyLifecycle {
  status: Exclude<KeyStatus, 'active'>;
  reason: string;
  replacedBy?: EnvKey;
  removeAfter?: string;
}

const reserved = (reason: string): KeyLifecycle => ({ status: 'reserved', reason });
const deprecated = (reason: string, removeAfter: string, replacedBy?: EnvKey): KeyLifecycle => ({
  status: 'deprecated',
  reason,
  removeAfter,
  ...(replacedBy ? { replacedBy } : {}),
});

/**
 * Keys declared in the schema but read nowhere outside src/config (verified by
 * a word-level search of src/, scripts/ and prisma/ on develop). `satisfies`
 * makes tsc reject a name that is not a schema key.
 */
export const KEY_LIFECYCLE = {
  KEEPER_ENABLED: reserved('settlement keeper (#89) has not landed'),
  KEEPER_POLL_MS: reserved('settlement keeper (#89) has not landed'),
  KEEPER_BATCH_SIZE: reserved('settlement keeper (#89) has not landed'),
  KEEPER_MAX_RETRIES: reserved('settlement keeper (#89) has not landed'),
  SSE_HEARTBEAT_INTERVAL_MS: reserved('SSE event stream (#95) has not landed'),
  SSE_POLL_INTERVAL_MS: reserved('SSE event stream (#95) has not landed'),
  SSE_MAX_CONCURRENT_STREAMS: reserved('SSE event stream (#95) has not landed'),
  SSE_REPLAY_PAGE_SIZE: reserved('SSE event stream (#95) has not landed'),
  RESOLUTION_ATTESTATION_ENABLED: reserved('resolution attestation worker (#88) has not landed'),
  RESOLUTION_ATTESTATION_POLL_MS: reserved('resolution attestation worker (#88) has not landed'),
  RESOLUTION_AUTO_APPROVE_ENABLED: reserved('automatic resolution approval is not implemented'),
  RESOLUTION_AUTO_APPROVE_MIN_CONFIDENCE: reserved('automatic resolution approval is not implemented'),
  RESOLUTION_HIGH_VALUE_THRESHOLD_USDC: reserved('automatic resolution approval is not implemented'),
  REFUND_PREPARE_TTL_SECONDS: reserved('prepared refunds (#57) have not landed'),
  PRICE_RESOLUTION_POLL_MS: reserved('no price-resolution poller reads it'),
  X402_ENABLED: reserved('x402 facilitator settlement is not wired; only validated at boot'),
  X402_FACILITATOR_URL: reserved('x402 facilitator settlement is not wired; only validated at boot'),
  X402_FACILITATOR_TIMEOUT_MS: reserved('x402 facilitator settlement is not wired'),
  X402_KEY_RELEASE_SECRET: reserved('x402 key release is not wired'),
  TRACE_CONFIDENTIAL: reserved('confidential traces are not implemented'),
  SOCKET_LIVE_LEDGER_LAG: deprecated('no socket handler reads it', 'v1.2.0'),
  QUESTION_DOC_VERSION: deprecated('the question document version is fixed in code', 'v1.2.0'),
  TRADER_MAX_PRICE_DRIFT_BPS: deprecated('the trader no longer reads a drift bound', 'v1.2.0'),
  SAGA_RECOVERY_SCAN: deprecated('the saga uses discoverLandedMarket (#41) instead of its own scan', 'v1.2.0'),
} satisfies Partial<Record<EnvKey, KeyLifecycle>>;

export function keyStatus(key: string): KeyStatus {
  return (KEY_LIFECYCLE as Record<string, KeyLifecycle>)[key]?.status ?? 'active';
}

/** Classic Levenshtein distance, capped so long strings stay cheap. */
export function editDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Prefix families that identify "our" variables: a first segment shared by at
 * least two schema keys (KEEPER_, X402_, CHANNEL_, ...). Generic process
 * prefixes such as NODE_ are excluded so NODE_OPTIONS is never flagged.
 */
export function appPrefixes(schemaKeys: readonly string[]): Set<string> {
  const counts = new Map<string, number>();
  for (const key of schemaKeys) {
    const prefix = key.split('_')[0];
    if (!prefix || prefix === key) continue;
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }
  const generic = new Set(['NODE', 'NPM', 'PATH', 'HOME']);
  return new Set([...counts].filter(([p, n]) => n >= 2 && !generic.has(p)).map(([p]) => p));
}

export interface ConfigWarning {
  key: string;
  kind: 'deprecated' | 'reserved' | 'unknown';
  message: string;
}

/**
 * Inspects the raw environment (before parsing) for keys that are set but do
 * nothing: deprecated, reserved, or an unknown name in one of our prefix
 * families (a likely typo, with the closest schema key as a suggestion).
 * `<SECRET>_FILE` variants of secret names are accepted.
 */
export function collectConfigWarnings(
  env: NodeJS.ProcessEnv,
  schemaKeys: readonly string[],
  secretNames: readonly string[],
): ConfigWarning[] {
  const known = new Set(schemaKeys);
  const fileVars = new Set(secretNames.map((n) => `${n}_FILE`));
  const prefixes = appPrefixes(schemaKeys);
  const warnings: ConfigWarning[] = [];

  for (const key of Object.keys(env).sort()) {
    if (env[key] === undefined) continue;
    const meta = (KEY_LIFECYCLE as Record<string, KeyLifecycle>)[key];
    if (meta?.status === 'reserved') {
      warnings.push({ key, kind: 'reserved', message: `${key} has no effect in this version (${meta.reason})` });
      continue;
    }
    if (meta?.status === 'deprecated') {
      const replacement = meta.replacedBy ? `; use ${meta.replacedBy}` : '';
      warnings.push({
        key,
        kind: 'deprecated',
        message: `${key} is deprecated and will be removed after ${meta.removeAfter} (${meta.reason})${replacement}`,
      });
      continue;
    }
    if (known.has(key) || fileVars.has(key)) continue;

    let best: string | null = null;
    let bestDistance = 3;
    for (const candidate of schemaKeys) {
      const d = editDistance(key, candidate, 2);
      if (d < bestDistance) {
        best = candidate;
        bestDistance = d;
      }
    }
    // Flag names in one of our prefix families, and near-misses of a schema
    // key even when the typo is in the prefix itself (CHANEL_ vs CHANNEL_).
    if (!prefixes.has(key.split('_')[0]) && !best) continue;
    const hint = best ? `; did you mean ${best}?` : '';
    warnings.push({ key, kind: 'unknown', message: `${key} is not a recognised setting and is ignored${hint}` });
  }
  return warnings;
}

/**
 * Maps a deprecated key's value onto its replacement when only the old name is
 * set. Returns the keys that were mapped. Mutates `env`.
 */
export function applyDeprecatedAliases(env: NodeJS.ProcessEnv): string[] {
  const mapped: string[] = [];
  for (const [key, meta] of Object.entries(KEY_LIFECYCLE as Record<string, KeyLifecycle>)) {
    if (meta.status !== 'deprecated' || !meta.replacedBy) continue;
    if (env[key] !== undefined && env[meta.replacedBy] === undefined) {
      env[meta.replacedBy] = env[key];
      mapped.push(key);
    }
  }
  return mapped;
}

const warned = new Set<string>();

/** Prints each warning once per process. */
export function emitConfigWarnings(warnings: ConfigWarning[]): void {
  for (const w of warnings) {
    if (warned.has(w.message)) continue;
    warned.add(w.message);
    console.warn(`[config] ${w.message}`);
  }
}
