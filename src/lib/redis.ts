import crypto from 'crypto';
import Redis from 'ioredis';
import { config } from '../config';
import { logger } from './logger';

let client: Redis | null = null;
const blocking = new Set<Redis>();

/**
 * Thrown when Redis is down, slow or otherwise unable to serve a command.
 * Callers on the auth path map this to `503 AUTH_UNAVAILABLE` (#50).
 */
export class RedisUnavailableError extends Error {
  constructor(message = 'Redis is unavailable', public readonly cause?: unknown) {
    super(message);
    this.name = 'RedisUnavailableError';
  }
}

/** True when the shared client is connected and ready to serve commands. */
export function redisHealthy(): boolean {
  return client?.status === 'ready';
}

function isConnectionError(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name ?? '';
  const code = (err as { code?: string } | null)?.code ?? '';
  const message = err instanceof Error ? err.message : String(err);
  return (
    name === 'MaxRetriesPerRequestError' ||
    name === 'RedisUnavailableError' ||
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'NR_CLOSED' ||
    /connection is closed|stream isn't writeable|command timed out|max retries/i.test(message)
  );
}

/**
 * Runs a Redis command, mapping connection/timeout failures to
 * {@link RedisUnavailableError}. Application errors (wrong type, script bugs)
 * pass through unchanged.
 */
export async function withRedis<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof RedisUnavailableError) throw err;
    if (isConnectionError(err)) throw new RedisUnavailableError('Redis is unavailable', err);
    throw err;
  }
}

/**
 * Shared lazy Redis connection.
 *
 * `enableOfflineQueue: false` makes commands fail fast while disconnected
 * instead of piling up in memory; the auth path turns that into a 503 rather
 * than hanging a request handler.
 */
export function getRedis(): Redis {
  if (!client) {
    client = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      commandTimeout: config.REDIS_COMMAND_TIMEOUT_MS,
      connectTimeout: config.REDIS_CONNECT_TIMEOUT_MS,
      lazyConnect: false,
    });
    client.on('error', (err) => logger.error({ err: err.message }, 'Redis error'));
    if (config.NODE_ENV === 'test') {
      // Unit tests run one process per file; a referenced Redis socket would
      // keep each process alive after its tests finish. Commands still work
      // on an unref'd socket.
      const c = client as unknown as { stream?: { unref?: () => void } };
      c.stream?.unref?.();
      client.on('connect', () => c.stream?.unref?.());
    }
  }
  return client;
}

/**
 * Warns when `maxmemory-policy` could evict non-TTL data (BullMQ, locks) to
 * make room for challenges. `NOPERM` on managed Redis is ignored.
 */
export async function checkRedisPolicy(): Promise<void> {
  try {
    const reply = await getRedis().config('GET', 'maxmemory-policy');
    const policy = Array.isArray(reply) ? String(reply[1]) : '';
    if (policy && !['volatile-ttl', 'volatile-lru', 'volatile-lfu', 'noeviction'].includes(policy)) {
      logger.warn(
        { policy },
        'Redis maxmemory-policy may evict non-TTL data (locks, queues); use volatile-ttl, volatile-lru or noeviction',
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/NOPERM|unknown command|not allowed/i.test(message)) {
      logger.warn({ err: message }, 'Could not read Redis maxmemory-policy');
    }
  }
}

/**
 * Options for a dedicated blocking connection. ioredis applies
 * `commandTimeout` to every command, including XREAD BLOCK: a 500 ms timeout
 * rejects an idle read before Redis answers. Blocking connections therefore
 * disable commandTimeout and use `blockingTimeout` (block time + grace) as the
 * safety net, so a lost reply still cannot wedge the loop forever (#293).
 */
export function blockingRedisOptions(blockMs: number, blockingTimeoutMs: number): {
  commandTimeout: 0;
  blockingTimeout: number;
} {
  return {
    commandTimeout: 0,
    blockingTimeout: Math.max(blockingTimeoutMs, blockMs + 100),
  };
}

/**
 * A new dedicated connection for blocking commands (XREAD BLOCK). A blocking
 * read on the shared client would stall every other command queued behind it,
 * such as the SEP-10 challenge GETDEL. The caller closes it with
 * releaseBlockingRedis(); closeRedis() closes any still open.
 */
export function getBlockingRedis(
  opts: { blockMs?: number; blockingTimeoutMs?: number } = {},
): Redis {
  const blockMs = opts.blockMs ?? 1000;
  const blockingTimeoutMs = opts.blockingTimeoutMs ?? 5000;
  const connection = getRedis().duplicate(blockingRedisOptions(blockMs, blockingTimeoutMs));
  connection.on('error', (err) => logger.error({ err: err.message }, 'Redis (blocking) error'));
  blocking.add(connection);
  return connection;
}

export function releaseBlockingRedis(connection: Redis): void {
  blocking.delete(connection);
  // disconnect() also aborts a command blocked in XREAD.
  connection.disconnect();
}

export async function closeRedis(): Promise<void> {
  for (const connection of blocking) connection.disconnect();
  blocking.clear();
  if (client) {
    await client.quit().catch(() => undefined);
    client = null;
  }
}

// ─── Distributed lock primitives (#36) ───────────────────────────────────────

/**
 * Extend the TTL of a held lock, but only if this call still owns it. Exposed
 * as a constant so the in-memory test double can recognise and execute it.
 */
export const RENEW_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
else
  return 0
end`;

/** Delete a lock, but only if this call still owns it (compare-and-delete). */
export const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
else
  return 0
end`;

/**
 * Write a cached sequence number, but only when the caller's fencing token is
 * at least as new as the token that last wrote it. A holder that lost its lock
 * (and therefore its token is older) can never move the sequence backwards.
 */
export const ADVANCE_SEQUENCE_SCRIPT = `
local stored = redis.call('GET', KEYS[2])
if stored and tonumber(stored) > tonumber(ARGV[2]) then
  return 0
end
redis.call('SET', KEYS[1], ARGV[1])
redis.call('SET', KEYS[2], ARGV[2])
return 1`;

export interface LockHandle {
  /** Unpredictable owner token; the lock value. */
  token: string;
  /** Monotonic fencing token, ordered across all acquisitions of this lock. */
  fence: number;
}

export interface AcquireLockDeps {
  redis?: Redis;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Injectable jitter source for deterministic tests. Returns [0, 1). */
  random?: () => number;
}

const LOCK_POLL_MS = 50;
const LOCK_POLL_JITTER_MS = 25;
// Waiter heartbeat TTL: must be > 3× LOCK_POLL_MS + jitter to survive a GC pause (#264).
const WAITER_HEARTBEAT_TTL_MS = 3 * (LOCK_POLL_MS + LOCK_POLL_JITTER_MS) + 500;

/**
 * Lua: remove the head member of <key>:queue when its waiter heartbeat key is
 * missing (dead process), then return the new head. Called by non-head waiters
 * each poll so a crashed waiter cannot wedge the queue indefinitely (#264).
 */
const PRUNE_HEAD_LUA = `
local head = redis.call('ZRANGE', KEYS[1], 0, 0)
if #head == 0 then return '' end
local hk = KEYS[2] .. ':' .. head[1]
if redis.call('EXISTS', hk) == 0 then
  redis.call('ZREM', KEYS[1], head[1])
  head = redis.call('ZRANGE', KEYS[1], 0, 0)
end
return #head > 0 and head[1] or ''
`;

/** All queue members registered by this process — removed by releaseAllWaiters() on shutdown (#264). */
const ownedWaiters = new Map<string, string>(); // queueKey → member

/** Remove every queue member this process registered. Called during shutdown before closeRedis(). */
export async function releaseAllWaiters(r: Redis = getRedis()): Promise<void> {
  await Promise.all(
    Array.from(ownedWaiters.entries()).map(([queueKey, member]) =>
      r.zrem(queueKey, member).catch(() => undefined),
    ),
  );
  ownedWaiters.clear();
}

/**
 * Fair, FIFO per-key lock. Waiters take a monotonic ticket from
 * `<key>:fence`, push it onto the `<key>:queue` sorted set and only the head of
 * that queue tries to take the lock, so a busy cron cannot starve an admin
 * call. The lock itself is a single `SET NX PX` so a crashed holder cannot
 * block the queue for longer than its TTL.
 *
 * Returns null when `waitMs` elapses without acquiring.
 */
export async function acquireLock(
  key: string,
  ttlMs: number,
  waitMs: number,
  deps: AcquireLockDeps = {},
): Promise<LockHandle | null> {
  const redis = deps.redis ?? getRedis();
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const random = deps.random ?? Math.random;

  const token = crypto.randomUUID();
  const fence = await redis.incr(`${key}:fence`);
  const member = `${fence}:${token}`;
  const queueKey = `${key}:queue`;
  const heartbeatKey = `${queueKey}:${member}`;
  await redis.zadd(queueKey, fence, member);
  // Heartbeat key proves this waiter is alive; renewed each poll (#264).
  await redis.set(heartbeatKey, '1', 'PX', WAITER_HEARTBEAT_TTL_MS);
  ownedWaiters.set(queueKey, member);
  const deadline = now() + waitMs;

  try {
    for (;;) {
      // Renew heartbeat so the PRUNE_HEAD_LUA doesn't reap us during GC pauses.
      await redis.set(heartbeatKey, '1', 'PX', WAITER_HEARTBEAT_TTL_MS).catch(() => undefined);

      const head = await redis.zrange(queueKey, 0, 0);
      if (head.length > 0 && head[0] === member) {
        const acquired = await redis.set(key, token, 'PX', ttlMs, 'NX');
        if (acquired === 'OK') {
          await redis.zrem(queueKey, member);
          await redis.del(heartbeatKey).catch(() => undefined);
          ownedWaiters.delete(queueKey);
          return { token, fence };
        }
      } else {
        // Not the head: prune it if it is dead (#264).
        await redis.eval(PRUNE_HEAD_LUA, 2, queueKey, queueKey).catch(() => undefined);
      }
      if (now() >= deadline) return null;
      await sleep(LOCK_POLL_MS + Math.floor(random() * LOCK_POLL_JITTER_MS));
    }
  } catch (err) {
    await redis.zrem(queueKey, member).catch(() => undefined);
    await redis.del(heartbeatKey).catch(() => undefined);
    ownedWaiters.delete(queueKey);
    throw err;
  } finally {
    // Always remove from owned set when we exit (success, timeout or error).
    ownedWaiters.delete(queueKey);
  }
}

/** Renew a held lock. False when it has already expired or been taken over. */
export async function renewLock(key: string, token: string, ttlMs: number, redis: Redis = getRedis()): Promise<boolean> {
  const result = await redis.eval(RENEW_LOCK_SCRIPT, 1, key, token, String(ttlMs));
  return Number(result) === 1;
}

/** Release a held lock (no-op if it was already lost). */
export async function releaseLock(key: string, token: string, redis: Redis = getRedis()): Promise<void> {
  await redis.eval(RELEASE_LOCK_SCRIPT, 1, key, token);
}

/** Advance the cached sequence to `seq`, fenced by `fence`. */
export async function advanceSequence(
  seqKey: string,
  fenceKey: string,
  seq: bigint,
  fence: number,
  redis: Redis = getRedis(),
): Promise<boolean> {
  const result = await redis.eval(ADVANCE_SEQUENCE_SCRIPT, 2, seqKey, fenceKey, seq.toString(), String(fence));
  return Number(result) === 1;
}
