import crypto from 'crypto';
import type Redis from 'ioredis';
import { config } from '../config';
import { logger } from './logger';
import { getRedis } from './redis';
import { ChainError } from '../services/stellar/errors';
import { currentCallerClass, isHigherCallerClass, type CallerClass } from './context';
import { withLoadTracker, type LoadTracker } from './resilience';

export interface CacheEntry<T> {
  value: T;
  ledger: number;
  readAt: number;
  gen: number;
}

export interface ChainCacheStats {
  hits: number;
  misses: number;
  coalesced: number;
  staleRejects: number;
  intentBypasses: number;
  genRaceRejects: number;
  waiterReloads: number;
}

export interface ChainCache {
  get<T>(
    key: string,
    opts: { ttlMs: number; tags: string[] },
    load: () => Promise<{ value: T; ledger: number }>,
  ): Promise<CacheEntry<T> & { cached: boolean; intent?: boolean }>;
  invalidateTag(tag: string, atLedger?: number): Promise<void>;
  beginWrite(tags: string[], ttlMs: number): Promise<string>;
  endWrite(token: string): Promise<void>;
  stats(): ChainCacheStats;
}

// ─── Singleton Registry ─────────────────────────────────────────────────────

let activeChainCache: ChainCache | null = null;

export function getChainCache(): ChainCache {
  if (!activeChainCache) {
    try {
      activeChainCache = redisChainCache(getRedis());
    } catch {
      activeChainCache = memoryChainCache();
    }
  }
  return activeChainCache;
}

export function setChainCache(cache: ChainCache | null): void {
  activeChainCache = cache;
}

// ─── Codec ──────────────────────────────────────────────────────────────────

export function encode(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (typeof val === 'bigint') {
      return { $bigint: val.toString() };
    }
    if (Buffer.isBuffer(val) || val instanceof Uint8Array) {
      return { $buf: Buffer.from(val).toString('hex') };
    }
    return val;
  });
}

export function decode<T>(text: string): T {
  return JSON.parse(text, (_key, val) => {
    if (val && typeof val === 'object') {
      const obj = val as Record<string, unknown>;
      if (typeof obj.$bigint === 'string') {
        return BigInt(obj.$bigint);
      }
      if (typeof obj.$buf === 'string') {
        return Buffer.from(obj.$buf, 'hex') as any;
      }
    }
    return val;
  }) as T;
}

// ─── Key Helper ─────────────────────────────────────────────────────────────

export function chainKey(contractId: string, method: string, args: unknown): string {
  const netHash = crypto
    .createHash('sha256')
    .update(config.STELLAR_NETWORK_PASSPHRASE)
    .digest('hex')
    .slice(0, 16);
  const argsHash = crypto.createHash('sha256').update(encode(args)).digest('hex').slice(0, 32);
  return `chain:v1:${netHash}:${contractId}:${method}:${argsHash}`;
}

// ─── Lua Scripts (#330) ─────────────────────────────────────────────────────

/**
 * Atomically increments a tag's generation and monotonically advances its
 * minimum ledger bound so late/older invalidations never lower the floor.
 *
 * KEYS[1]: chain:gen:<tag>
 * KEYS[2]: chain:minLedger:<tag>
 * ARGV[1]: atLedger string, or '' when no ledger bound is supplied
 */
export const INVALIDATE_TAG_LUA = `
local newGen = redis.call('INCR', KEYS[1])
if ARGV[1] ~= '' then
  local incoming = tonumber(ARGV[1])
  local cur = tonumber(redis.call('GET', KEYS[2]) or '0')
  if incoming > cur then
    redis.call('SET', KEYS[2], ARGV[1])
  end
end
return newGen
`;

/**
 * Atomically verifies pre-load tag generations, absence of active write
 * intents, minimum-ledger bounds, and ledger monotonicity before writing a
 * cache entry.
 *
 * KEYS[1]: cache key
 * KEYS[2 .. 1+n]: chain:gen:<tag_i>
 * KEYS[2+n .. 1+2n]: chain:minLedger:<tag_i>
 * KEYS[2+2n .. 1+3n]: chain:intentCount:<tag_i>
 * ARGV[1]: serialized JSON entry
 * ARGV[2]: ttlMs
 * ARGV[3]: loaded ledger (integer)
 * ARGV[4]: n (tag count)
 * ARGV[5 .. 4+n]: pre-load generation for tag_i
 * ARGV[5+n]: '1' if negative error entry, '0' otherwise
 */
export const STORE_IF_GEN_LUA = `
local n = tonumber(ARGV[4])
local loadedLedger = tonumber(ARGV[3])
local isNeg = ARGV[5 + n] == '1'
for i = 1, n do
  local curGen = tonumber(redis.call('GET', KEYS[1 + i]) or '0')
  local preGen = tonumber(ARGV[4 + i])
  if curGen ~= preGen then
    return 'GEN_RACE'
  end
  local intentCnt = tonumber(redis.call('GET', KEYS[1 + 2 * n + i]) or '0')
  if intentCnt > 0 then
    return 'INTENT'
  end
  if not isNeg then
    local minL = tonumber(redis.call('GET', KEYS[1 + n + i]) or '0')
    if minL > 0 and loadedLedger < minL then
      return 'STALE_LEDGER'
    end
  end
end
if not isNeg then
  local existing = redis.call('GET', KEYS[1])
  if existing then
    local ok, parsed = pcall(cjson.decode, existing)
    if ok and parsed and not parsed.isNegativeError and tonumber(parsed.ledger or 0) > loadedLedger then
      return 'STALE_PREV'
    end
  end
end
redis.call('SET', KEYS[1], ARGV[1], 'PX', tonumber(ARGV[2]))
return 'OK'
`;

/**
 * Compare-and-delete lock release so a slow holder never deletes another
 * holder's lock after TTL expiry.
 */
export const UNLOCK_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

/**
 * Registers an in-flight write intent across all affected tags.
 *
 * KEYS[1]: chain:intentToken:<token>
 * KEYS[2 .. 1+n]: chain:intent:<tag_i>:<token>
 * KEYS[2+n .. 1+2n]: chain:intentCount:<tag_i>
 * ARGV[1]: ttlMs
 * ARGV[2]: JSON array of tags
 * ARGV[3]: n
 */
export const BEGIN_WRITE_LUA = `
local ttl = tonumber(ARGV[1])
local n = tonumber(ARGV[3])
redis.call('SET', KEYS[1], ARGV[2], 'PX', ttl)
for i = 1, n do
  redis.call('SET', KEYS[1 + i], '1', 'PX', ttl)
  redis.call('INCR', KEYS[1 + n + i])
  local pttl = redis.call('PTTL', KEYS[1 + n + i])
  if pttl < ttl then
    redis.call('PEXPIRE', KEYS[1 + n + i], ttl)
  end
end
return 1
`;

/**
 * Idempotently clears a write intent, decrementing intent counts only for
 * tags whose intent key was still live.
 *
 * KEYS[1]: chain:intentToken:<token>
 * KEYS[2 .. 1+n]: chain:intent:<tag_i>:<token>
 * KEYS[2+n .. 1+2n]: chain:intentCount:<tag_i>
 * ARGV[1]: n
 */
export const END_WRITE_LUA = `
local n = tonumber(ARGV[1])
redis.call('DEL', KEYS[1])
for i = 1, n do
  local removed = redis.call('DEL', KEYS[1 + i])
  if removed == 1 then
    local c = redis.call('DECR', KEYS[1 + n + i])
    if c <= 0 then
      redis.call('DEL', KEYS[1 + n + i])
    end
  end
end
return 1
`;

// ─── Memory Chain Cache ─────────────────────────────────────────────────────

interface StoredMemoryEntry {
  encodedValue?: string;
  isNegativeError?: boolean;
  errorPayload?: { message: string; contractError: string | null };
  ledger: number;
  readAt: number;
  ttlMs: number;
  tagGens: Record<string, number>;
}

interface MemoryIntent {
  tags: string[];
  expiresAt: number;
}

export function memoryChainCache(): ChainCache {
  const entries = new Map<string, StoredMemoryEntry>();
  const tagGens = new Map<string, number>();
  const minLedgers = new Map<string, number>();
  const intents = new Map<string, MemoryIntent>();
  const inFlight = new Map<string, Promise<any>>();

  let hits = 0;
  let misses = 0;
  let coalesced = 0;
  let staleRejects = 0;
  let intentBypasses = 0;
  let genRaceRejects = 0;
  let waiterReloads = 0;

  function hasActiveIntent(tags: string[], now: number): boolean {
    if (tags.length === 0 || intents.size === 0) return false;
    for (const [tok, rec] of intents) {
      if (rec.expiresAt <= now) {
        intents.delete(tok);
        continue;
      }
      for (const tag of tags) {
        if (rec.tags.includes(tag)) return true;
      }
    }
    return false;
  }

  function snapshotGens(tags: string[]): Record<string, number> {
    const snap: Record<string, number> = {};
    for (const tag of tags) {
      snap[tag] = tagGens.get(tag) ?? 0;
    }
    return snap;
  }

  function isEntryValid(stored: StoredMemoryEntry, tags: string[], now: number): boolean {
    if (now - stored.readAt >= stored.ttlMs) return false;
    for (const tag of tags) {
      const currentGen = tagGens.get(tag) ?? 0;
      const recordedGen = stored.tagGens[tag] ?? 0;
      if (currentGen > recordedGen) return false;
      if (!stored.isNegativeError) {
        const minL = minLedgers.get(tag) ?? 0;
        if (minL > 0 && stored.ledger < minL) return false;
      }
    }
    return true;
  }

  return {
    async invalidateTag(tag: string, atLedger?: number): Promise<void> {
      tagGens.set(tag, (tagGens.get(tag) ?? 0) + 1);
      if (atLedger !== undefined) {
        minLedgers.set(tag, Math.max(minLedgers.get(tag) ?? 0, atLedger));
      }
    },

    async beginWrite(tags: string[], ttlMs: number): Promise<string> {
      const token = crypto.randomUUID();
      const unique = [...new Set(tags)];
      if (unique.length > 0 && ttlMs > 0) {
        intents.set(token, { tags: unique, expiresAt: Date.now() + ttlMs });
      }
      return token;
    },

    async endWrite(token: string): Promise<void> {
      intents.delete(token);
    },

    async get<T>(
      key: string,
      opts: { ttlMs: number; tags: string[] },
      load: () => Promise<{ value: T; ledger: number }>,
    ): Promise<CacheEntry<T> & { cached: boolean; intent?: boolean }> {
      if (hasActiveIntent(opts.tags, Date.now())) {
        intentBypasses++;
        const loaded = await load();
        return {
          value: loaded.value,
          ledger: loaded.ledger,
          readAt: Date.now(),
          gen: 0,
          cached: false,
          intent: true,
        };
      }

      if (inFlight.has(key)) {
        coalesced++;
        return inFlight.get(key)!;
      }

      const execute = async (): Promise<CacheEntry<T> & { cached: boolean; intent?: boolean }> => {
        const now = Date.now();
        const stored = entries.get(key);

        if (stored && isEntryValid(stored, opts.tags, now)) {
          if (stored.isNegativeError) {
            hits++;
            throw new ChainError(
              stored.errorPayload?.message ?? 'Negative cached contract error',
              stored.errorPayload?.contractError ?? null,
            );
          }
          hits++;
          return {
            value: decode<T>(stored.encodedValue!),
            ledger: stored.ledger,
            readAt: stored.readAt,
            gen: 0,
            cached: true,
          };
        }

        misses++;
        // Snapshot generations BEFORE invoking load() so any invalidation that
        // lands while the RPC read is in flight prevents caching the stale value.
        const preTagGens = snapshotGens(opts.tags);

        try {
          const loaded = await load();
          const finishedAt = Date.now();

          for (const tag of opts.tags) {
            if ((tagGens.get(tag) ?? 0) !== preTagGens[tag]) {
              genRaceRejects++;
              staleRejects++;
              return {
                value: loaded.value,
                ledger: loaded.ledger,
                readAt: finishedAt,
                gen: 0,
                cached: false,
              };
            }
          }

          if (hasActiveIntent(opts.tags, finishedAt)) {
            return {
              value: loaded.value,
              ledger: loaded.ledger,
              readAt: finishedAt,
              gen: 0,
              cached: false,
              intent: true,
            };
          }

          let minLedgerAllowed = 0;
          for (const tag of opts.tags) {
            const ml = minLedgers.get(tag) ?? 0;
            if (ml > minLedgerAllowed) minLedgerAllowed = ml;
          }

          if (minLedgerAllowed > 0 && loaded.ledger < minLedgerAllowed) {
            staleRejects++;
            return {
              value: loaded.value,
              ledger: loaded.ledger,
              readAt: finishedAt,
              gen: 0,
              cached: false,
            };
          }

          const latestStored = entries.get(key);
          if (latestStored && !latestStored.isNegativeError && latestStored.ledger > loaded.ledger) {
            staleRejects++;
            return {
              value: loaded.value,
              ledger: loaded.ledger,
              readAt: finishedAt,
              gen: 0,
              cached: false,
            };
          }

          entries.set(key, {
            encodedValue: encode(loaded.value),
            ledger: loaded.ledger,
            readAt: finishedAt,
            ttlMs: opts.ttlMs,
            tagGens: preTagGens,
          });

          return {
            value: loaded.value,
            ledger: loaded.ledger,
            readAt: finishedAt,
            gen: 0,
            cached: false,
          };
        } catch (err) {
          if (err instanceof ChainError && err.contractError) {
            const finishedAt = Date.now();
            const genChanged = opts.tags.some((t) => (tagGens.get(t) ?? 0) !== preTagGens[t]);
            if (!genChanged && !hasActiveIntent(opts.tags, finishedAt)) {
              entries.set(key, {
                isNegativeError: true,
                errorPayload: { message: err.message, contractError: err.contractError },
                ledger: 0,
                readAt: finishedAt,
                ttlMs: config.CHAIN_CACHE_NEG_TTL_MS,
                tagGens: preTagGens,
              });
            }
          }
          throw err;
        }
      };

      return runSingleFlight(inFlight, key, execute, {
        onCoalesced: () => {
          coalesced++;
        },
        onPromoted: () => {
          promoted++;
        },
      });
    },

    stats(): ChainCacheStats {
      return { hits, misses, coalesced, staleRejects, intentBypasses, genRaceRejects, waiterReloads };
    },
  };
}

// ─── Redis Chain Cache ──────────────────────────────────────────────────────

let lastRedisCacheLog = 0;

interface ParsedRedisEntry {
  encodedValue?: string;
  isNegativeError?: boolean;
  errorPayload?: { message: string; contractError: string | null };
  ledger: number;
  readAt: number;
  tagGens?: Record<string, number>;
}

interface TagMeta {
  gens: number[];
  minLedgers: number[];
  hasIntent: boolean;
}

export function redisChainCache(redis: Redis): ChainCache {
  const fallback = memoryChainCache();
  const inFlight = new Map<string, Promise<any>>();
  const localIntentTags = new Map<string, string[]>();
  const fallbackTokens = new Map<string, string>();

  let degradedSince = 0;
  let hits = 0;
  let misses = 0;
  let coalesced = 0;
  let staleRejects = 0;
  let intentBypasses = 0;
  let genRaceRejects = 0;
  let waiterReloads = 0;

  async function readTagMeta(tags: string[]): Promise<TagMeta> {
    if (tags.length === 0) {
      return { gens: [], minLedgers: [], hasIntent: false };
    }
    const keys = [
      ...tags.map((t) => `chain:gen:${t}`),
      ...tags.map((t) => `chain:minLedger:${t}`),
      ...tags.map((t) => `chain:intentCount:${t}`),
    ];
    const vals = await redis.mget(...keys);
    const n = tags.length;
    const gens: number[] = [];
    const minLedgers: number[] = [];
    let hasIntent = false;
    for (let i = 0; i < n; i++) {
      gens.push(parseInt(vals[i] ?? '0', 10) || 0);
      minLedgers.push(parseInt(vals[n + i] ?? '0', 10) || 0);
      if ((parseInt(vals[2 * n + i] ?? '0', 10) || 0) > 0) {
        hasIntent = true;
      }
    }
    return { gens, minLedgers, hasIntent };
  }

  function isEntryValid(parsed: ParsedRedisEntry, tags: string[], meta: TagMeta): boolean {
    if (degradedSince > 0 && (typeof parsed.readAt !== 'number' || parsed.readAt < degradedSince)) {
      return false;
    }
    for (let i = 0; i < tags.length; i++) {
      const tag = tags[i];
      const recordedGen = parsed.tagGens?.[tag] ?? 0;
      if (meta.gens[i] > recordedGen) return false;
      if (!parsed.isNegativeError && meta.minLedgers[i] > 0 && parsed.ledger < meta.minLedgers[i]) {
        return false;
      }
    }
    return true;
  }

  function buildStoreKeys(key: string, tags: string[]): string[] {
    return [
      key,
      ...tags.map((t) => `chain:gen:${t}`),
      ...tags.map((t) => `chain:minLedger:${t}`),
      ...tags.map((t) => `chain:intentCount:${t}`),
    ];
  }

  return {
    async invalidateTag(tag: string, atLedger?: number): Promise<void> {
      try {
        await redis.eval(
          INVALIDATE_TAG_LUA,
          2,
          `chain:gen:${tag}`,
          `chain:minLedger:${tag}`,
          atLedger !== undefined ? String(atLedger) : '',
        );
      } catch {
        degradedSince = Date.now();
        await fallback.invalidateTag(tag, atLedger);
      }
    },

    async beginWrite(tags: string[], ttlMs: number): Promise<string> {
      const token = crypto.randomUUID();
      const unique = [...new Set(tags)];
      if (unique.length === 0 || ttlMs <= 0) return token;

      localIntentTags.set(token, unique);
      const keys = [
        `chain:intentToken:${token}`,
        ...unique.map((t) => `chain:intent:${t}:${token}`),
        ...unique.map((t) => `chain:intentCount:${t}`),
      ];
      try {
        await redis.eval(BEGIN_WRITE_LUA, keys.length, ...keys, String(ttlMs), JSON.stringify(unique), String(unique.length));
      } catch {
        degradedSince = Date.now();
        const fbToken = await fallback.beginWrite(unique, ttlMs);
        fallbackTokens.set(token, fbToken);
      }
      return token;
    },

    async endWrite(token: string): Promise<void> {
      const fbToken = fallbackTokens.get(token);
      if (fbToken) {
        fallbackTokens.delete(token);
        await fallback.endWrite(fbToken).catch(() => undefined);
      }

      let tags = localIntentTags.get(token);
      localIntentTags.delete(token);

      try {
        if (!tags) {
          const raw = await redis.get(`chain:intentToken:${token}`);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) tags = parsed.filter((x): x is string => typeof x === 'string');
          }
        }
        if (!tags || tags.length === 0) return;
        const keys = [
          `chain:intentToken:${token}`,
          ...tags.map((t) => `chain:intent:${t}:${token}`),
          ...tags.map((t) => `chain:intentCount:${t}`),
        ];
        await redis.eval(END_WRITE_LUA, keys.length, ...keys, String(tags.length));
      } catch {
        // Intents expire on their own via TTL if Redis is unreachable.
      }
    },

    async get<T>(
      key: string,
      opts: { ttlMs: number; tags: string[] },
      load: () => Promise<{ value: T; ledger: number }>,
    ): Promise<CacheEntry<T> & { cached: boolean; intent?: boolean }> {
      let rawCache: string | null = null;
      let initialMeta: TagMeta;
      try {
        [rawCache, initialMeta] = await Promise.all([redis.get(key), readTagMeta(opts.tags)]);
      } catch (err) {
        const now = Date.now();
        if (now - lastRedisCacheLog > 60_000) {
          logger.warn({ err }, 'Redis chain cache unreachable; bypassing cache');
          lastRedisCacheLog = now;
        }
        const loaded = await load();
        return { value: loaded.value, ledger: loaded.ledger, readAt: Date.now(), gen: 0, cached: false };
      }

      if (initialMeta.hasIntent) {
        intentBypasses++;
        const loaded = await load();
        return { value: loaded.value, ledger: loaded.ledger, readAt: Date.now(), gen: 0, cached: false, intent: true };
      }

      if (rawCache) {
        try {
          const parsed = JSON.parse(rawCache) as ParsedRedisEntry;
          if (isEntryValid(parsed, opts.tags, initialMeta)) {
            if (parsed.isNegativeError) {
              hits++;
              throw new ChainError(
                parsed.errorPayload?.message ?? 'Negative cached contract error',
                parsed.errorPayload?.contractError ?? null,
              );
            }
            hits++;
            return {
              value: decode<T>(parsed.encodedValue!),
              ledger: parsed.ledger,
              readAt: parsed.readAt,
              gen: 0,
              cached: true,
            };
          }
        } catch (err) {
          if (err instanceof ChainError) throw err;
        }
      }

      if (inFlight.has(key)) {
        coalesced++;
        return inFlight.get(key)!;
      }

      const execute = async (): Promise<CacheEntry<T> & { cached: boolean; intent?: boolean }> => {
        misses++;

        // Cross-instance single-flight lock
        const lockKey = `chain:lock:${key}`;
        const token = crypto.randomUUID();
        let acquiredLock = false;
        try {
          const lockRes = await redis.set(lockKey, token, 'PX', 5000, 'NX');
          acquiredLock = lockRes === 'OK';
        } catch {}

        if (!acquiredLock) {
          const waitLimit = config.CHAIN_CACHE_WAIT_MS;
          const pollStepMs = Math.min(50, Math.max(10, Math.floor(waitLimit / 10)));
          const startWait = Date.now();
          while (Date.now() - startWait < waitLimit) {
            await new Promise((r) => setTimeout(r, pollStepMs));
            try {
              const [maybeUpdated, waiterMeta] = await Promise.all([
                redis.get(key),
                readTagMeta(opts.tags),
              ]);
              if (waiterMeta.hasIntent) {
                intentBypasses++;
                const loaded = await load();
                return {
                  value: loaded.value,
                  ledger: loaded.ledger,
                  readAt: Date.now(),
                  gen: 0,
                  cached: false,
                  intent: true,
                };
              }
              if (maybeUpdated) {
                const parsed = JSON.parse(maybeUpdated) as ParsedRedisEntry;
                if (isEntryValid(parsed, opts.tags, waiterMeta)) {
                  if (parsed.isNegativeError) {
                    coalesced++;
                    throw new ChainError(
                      parsed.errorPayload?.message ?? 'Negative cached contract error',
                      parsed.errorPayload?.contractError ?? null,
                    );
                  }
                  coalesced++;
                  return {
                    value: decode<T>(parsed.encodedValue!),
                    ledger: parsed.ledger,
                    readAt: parsed.readAt,
                    gen: 0,
                    cached: true,
                  };
                }
              }
            } catch (err) {
              if (err instanceof ChainError) throw err;
            }
          }

          // Entry remained invalid past CHAIN_CACHE_WAIT_MS: load directly (uncached).
          waiterReloads++;
          const loaded = await load();
          return {
            value: loaded.value,
            ledger: loaded.ledger,
            readAt: Date.now(),
            gen: 0,
            cached: false,
          };
        }

        let preMeta = initialMeta;
        try {
          // Snapshot generations BEFORE calling load() so overlapping invalidations
          // cannot be overwritten by a pre-invalidation read.
          preMeta = await readTagMeta(opts.tags);
          if (preMeta.hasIntent) {
            intentBypasses++;
            const loaded = await load();
            return {
              value: loaded.value,
              ledger: loaded.ledger,
              readAt: Date.now(),
              gen: 0,
              cached: false,
              intent: true,
            };
          }

          const preTagGens: Record<string, number> = {};
          for (let i = 0; i < opts.tags.length; i++) {
            preTagGens[opts.tags[i]] = preMeta.gens[i];
          }

          const loaded = await load();
          const readAt = Date.now();
          const entryData: ParsedRedisEntry = {
            encodedValue: encode(loaded.value),
            ledger: loaded.ledger,
            readAt,
            tagGens: preTagGens,
          };

          const storeKeys = buildStoreKeys(key, opts.tags);
          const outcome = await redis.eval(
            STORE_IF_GEN_LUA,
            storeKeys.length,
            ...storeKeys,
            JSON.stringify(entryData),
            String(opts.ttlMs),
            String(loaded.ledger),
            String(opts.tags.length),
            ...preMeta.gens.map(String),
            '0',
          );

          if (outcome === 'GEN_RACE') {
            genRaceRejects++;
            staleRejects++;
          } else if (outcome === 'STALE_LEDGER' || outcome === 'STALE_PREV') {
            staleRejects++;
          } else if (outcome === 'INTENT') {
            return {
              value: loaded.value,
              ledger: loaded.ledger,
              readAt,
              gen: 0,
              cached: false,
              intent: true,
            };
          }

          return {
            value: loaded.value,
            ledger: loaded.ledger,
            readAt,
            gen: 0,
            cached: false,
          };
        } catch (err) {
          if (err instanceof ChainError && err.contractError) {
            try {
              const preTagGens: Record<string, number> = {};
              for (let i = 0; i < opts.tags.length; i++) {
                preTagGens[opts.tags[i]] = preMeta.gens[i];
              }
              const negEntry: ParsedRedisEntry = {
                isNegativeError: true,
                errorPayload: { message: err.message, contractError: err.contractError },
                ledger: 0,
                readAt: Date.now(),
                tagGens: preTagGens,
              };
              const storeKeys = buildStoreKeys(key, opts.tags);
              await redis.eval(
                STORE_IF_GEN_LUA,
                storeKeys.length,
                ...storeKeys,
                JSON.stringify(negEntry),
                String(config.CHAIN_CACHE_NEG_TTL_MS),
                '0',
                String(opts.tags.length),
                ...preMeta.gens.map(String),
                '1',
              );
            } catch {}
          }
          throw err;
        } finally {
          if (acquiredLock) {
            redis.eval(UNLOCK_LUA, 1, lockKey, token).catch(() => {});
          }
        }
      };

      return runSingleFlight(inFlight, key, execute, {
        onCoalesced: () => {
          coalesced++;
        },
        onPromoted: () => {
          promoted++;
        },
      });
    },

    stats(): ChainCacheStats {
      return { hits, misses, coalesced, staleRejects, intentBypasses, genRaceRejects, waiterReloads };
    },
  };
}
