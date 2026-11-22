/**
 * Redis Streams socket adapter bounds and observability (#293).
 *
 * The adapter reads its stream with XREAD BLOCK on duplicated clients. ioredis
 * applies `commandTimeout` to every command, so a 500 ms command timeout
 * rejects an idle BLOCK 1000 read before Redis answers; the adapter swallows
 * the error and re-polls immediately, and entries returned to rejected reads
 * are lost. The adapter client here disables commandTimeout and uses
 * `blockingTimeout` as the safety net.
 *
 * The stream bound is explicit (`SOCKET_ADAPTER_MAXLEN` / read count) and every
 * instance publishes its offset, lag, stream length, trimmed-past gaps and read
 * errors to Redis so the cluster view is one HGETALL away.
 */
import { createAdapter } from '@socket.io/redis-streams-adapter';
import type Redis from 'ioredis';
import { config } from '../config';
import { logger } from './logger';
import { blockingRedisOptions, getRedis } from './redis';

export interface SocketStreamSnapshot {
  instanceId: string;
  /** Last stream id the adapter delivered to a namespace. */
  offset: string | null;
  /** Entries currently in the stream. */
  streamLength: number;
  /** Entries between the adapter offset and the tail (0 when unknown). */
  lagEntries: number;
  /** Wall-clock age of the last delivered entry, or of the tail when idle. */
  lagMs: number;
  /** Entries that disappeared (trimmed) before this instance read them. */
  trimmedGaps: number;
  /** XREAD failures, including blocking timeouts. */
  readErrors: number;
  /** True while this instance is shedding coalescable public traffic. */
  shedding: boolean;
  /** True when clients on this instance missed entries and must resync. */
  resyncRequired: boolean;
  updatedAt: string;
}

const streamIdMs = (id: string | null): number | null => {
  if (!id) return null;
  const ms = Number(id.split('-')[0]);
  return Number.isFinite(ms) ? ms : null;
};

const streamIdSeq = (id: string): number => Number(id.split('-')[1] ?? 0) || 0;

/** Number of ids strictly between two stream ids in the same millisecond. */
export function gapBetween(previous: string | null, next: string): number {
  if (!previous || previous === '$' || previous === '0-0') return 0;
  const pMs = streamIdMs(previous);
  const nMs = streamIdMs(next);
  if (pMs === null || nMs === null) return 0;
  if (nMs !== pMs) return 0; // a new millisecond is not evidence of a gap
  return Math.max(0, streamIdSeq(next) - streamIdSeq(previous) - 1);
}

export class SocketStreamMonitor {
  readonly instanceId: string;
  private offset: string | null = null;
  private lastEntryAtMs: number | null = null;
  private trimmedGaps = 0;
  private readErrors = 0;
  private resyncRequired = false;
  private streamLength = 0;
  private tailId: string | null = null;
  private now: () => number;

  constructor(opts: { instanceId?: string; now?: () => number } = {}) {
    this.instanceId = opts.instanceId ?? config.INSTANCE_ID;
    this.now = opts.now ?? Date.now;
  }

  /** Called by the adapter for every entry it actually hands to a namespace. */
  onEntry(offset: string): void {
    const gap = gapBetween(this.offset, offset);
    if (gap > 0) {
      this.trimmedGaps += gap;
      this.resyncRequired = true;
      logger.warn({ instanceId: this.instanceId, previous: this.offset, offset, gap }, 'Socket stream: entries were trimmed past this instance');
    }
    this.offset = offset;
    this.lastEntryAtMs = streamIdMs(offset) ?? this.now();
  }

  onReadError(err: unknown): void {
    this.readErrors++;
    logger.warn(
      { instanceId: this.instanceId, err: err instanceof Error ? err.message : String(err) },
      'Socket stream: XREAD failed',
    );
  }

  /** Fills stream length/tail and detects an offset that has been trimmed away. */
  observeStream(streamLength: number, tailId: string | null, offsetExists: boolean): void {
    this.streamLength = streamLength;
    this.tailId = tailId;
    if (this.offset && !offsetExists) {
      this.trimmedGaps++;
      this.resyncRequired = true;
      logger.warn({ instanceId: this.instanceId, offset: this.offset, tailId }, 'Socket stream: adapter offset was trimmed; clients must resync');
    }
  }

  consumeResync(): boolean {
    if (!this.resyncRequired) return false;
    this.resyncRequired = false;
    return true;
  }

  lagEntries(): number {
    if (!this.offset || !this.tailId) return this.streamLength;
    const oMs = streamIdMs(this.offset);
    const tMs = streamIdMs(this.tailId);
    if (oMs === null || tMs === null) return 0;
    if (this.offset === this.tailId) return 0;
    // Same-ms distance is exact; across milliseconds the entry count is the
    // safe upper bound (the stream cannot hold more than its length).
    if (oMs === tMs) return Math.max(0, streamIdSeq(this.tailId) - streamIdSeq(this.offset));
    return this.streamLength;
  }

  lagMs(): number {
    const at = this.lastEntryAtMs ?? streamIdMs(this.tailId);
    return at === null ? 0 : Math.max(0, this.now() - at);
  }

  shedding(): boolean {
    return this.lagEntries() >= config.SOCKET_ADAPTER_SHED_LAG_ENTRIES;
  }

  snapshot(): SocketStreamSnapshot {
    const lagEntries = this.lagEntries();
    return {
      instanceId: this.instanceId,
      offset: this.offset,
      streamLength: this.streamLength,
      lagEntries,
      lagMs: this.lagMs(),
      trimmedGaps: this.trimmedGaps,
      readErrors: this.readErrors,
      shedding: this.shedding(),
      resyncRequired: this.resyncRequired,
      updatedAt: new Date(this.now()).toISOString(),
    };
  }
}

const METRICS_PREFIX = 'oracledesk:socket-stream:metrics:';

/** Publishes this instance's snapshot; expires so a dead instance disappears. */
export async function publishSocketStreamMetrics(
  monitor: SocketStreamMonitor,
  redis: Redis = getRedis(),
): Promise<SocketStreamSnapshot> {
  const snapshot = monitor.snapshot();
  const ttlMs = Math.max(5000, config.SOCKET_ADAPTER_MONITOR_MS * 3);
  try {
    await redis.set(`${METRICS_PREFIX}${monitor.instanceId}`, JSON.stringify(snapshot), 'PX', ttlMs);
  } catch (err) {
    logger.debug({ err: err instanceof Error ? err.message : err }, 'Socket stream: metrics publish failed');
  }
  return snapshot;
}

export interface SocketStreamClusterStats {
  instances: SocketStreamSnapshot[];
  totals: {
    instances: number;
    maxLagEntries: number;
    maxLagMs: number;
    trimmedGaps: number;
    readErrors: number;
    shedding: number;
  };
}

/** Reads every live instance's snapshot and aggregates it. */
export async function socketStreamClusterStats(redis: Redis = getRedis()): Promise<SocketStreamClusterStats> {
  const instances: SocketStreamSnapshot[] = [];
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', `${METRICS_PREFIX}*`, 'COUNT', 100);
    cursor = next;
    if (keys.length === 0) continue;
    const rows = await redis.mget(...keys);
    for (const row of rows) {
      if (!row) continue;
      try {
        const raw = JSON.parse(row) as Record<string, unknown>;
        instances.push({
          instanceId: String(raw.instanceId ?? ''),
          offset: raw.offset ? String(raw.offset) : null,
          streamLength: Number(raw.streamLength ?? 0),
          lagEntries: Number(raw.lagEntries ?? 0),
          lagMs: Number(raw.lagMs ?? 0),
          trimmedGaps: Number(raw.trimmedGaps ?? 0),
          readErrors: Number(raw.readErrors ?? 0),
          shedding: raw.shedding === true || raw.shedding === '1',
          resyncRequired: raw.resyncRequired === true || raw.resyncRequired === '1',
          updatedAt: String(raw.updatedAt ?? ''),
        });
      } catch {
        /* ignore a malformed entry */
      }
    }
  } while (cursor !== '0');
  return {
    instances,
    totals: {
      instances: instances.length,
      maxLagEntries: instances.reduce((m, i) => Math.max(m, i.lagEntries), 0),
      maxLagMs: instances.reduce((m, i) => Math.max(m, i.lagMs), 0),
      trimmedGaps: instances.reduce((s, i) => s + i.trimmedGaps, 0),
      readErrors: instances.reduce((s, i) => s + i.readErrors, 0),
      shedding: instances.filter((i) => i.shedding).length,
    },
  };
}

/**
 * Creates the streams adapter with explicit bounds, a correctly blocking
 * client, and the per-entry hook that feeds the monitor. Returns the factory
 * plus a close function for the dedicated adapter client.
 */
export function createSocketStreamAdapter(
  opts: { redis?: Redis; monitor?: SocketStreamMonitor } = {},
): {
  adapter: ReturnType<typeof createAdapter>;
  monitor: SocketStreamMonitor;
  close: () => Promise<void>;
} {
  const monitor = opts.monitor ?? new SocketStreamMonitor();
  const base = opts.redis ?? getRedis();
  const adapterClient = base.duplicate(
    blockingRedisOptions(config.SOCKET_ADAPTER_BLOCK_MS, config.SOCKET_ADAPTER_BLOCKING_TIMEOUT_MS),
  );
  adapterClient.on('error', (err) => logger.error({ err: err.message }, 'Redis (socket adapter) error'));

  const duplicate = adapterClient.duplicate.bind(adapterClient);
  (adapterClient as unknown as { duplicate: (...args: unknown[]) => Redis }).duplicate = (...args: unknown[]) => {
    const client = duplicate(...(args as []));
    const xread = client.xread.bind(client);
    (client as unknown as { xread: (...a: unknown[]) => Promise<unknown> }).xread = (...a: unknown[]) =>
      (xread(...(a as [])) as Promise<unknown>).catch((err) => {
        monitor.onReadError(err);
        throw err;
      });
    return client;
  };

  const factory = createAdapter(adapterClient, {
    streamName: config.SOCKET_STREAM_NAME,
    maxLen: config.SOCKET_ADAPTER_MAXLEN,
    readCount: config.SOCKET_ADAPTER_READ_COUNT,
    blockTimeInMs: config.SOCKET_ADAPTER_BLOCK_MS,
  });

  const adapter = ((nsp: unknown) => {
    const instance = factory(nsp as never);
    const onRawMessage = instance.onRawMessage.bind(instance);
    instance.onRawMessage = (raw: unknown, offset: string) => {
      monitor.onEntry(offset);
      return onRawMessage(raw as never, offset);
    };
    return instance;
  }) as ReturnType<typeof createAdapter>;

  return {
    adapter,
    monitor,
    close: async () => {
      adapterClient.disconnect();
    },
  };
}

/**
 * Periodically samples the stream length/tail and publishes the snapshot.
 * `onResync` is called once per detected trimmed-past gap so clients can be
 * told to refetch durable state.
 */
export function startSocketStreamMonitor(
  monitor: SocketStreamMonitor,
  opts: { redis?: Redis; onResync?: (snapshot: SocketStreamSnapshot) => void } = {},
): () => void {
  const redis = opts.redis ?? getRedis();
  let stopped = false;
  let running = false;
  const sample = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const [length, tail] = await Promise.all([
        redis.xlen(config.SOCKET_STREAM_NAME),
        redis.xrevrange(config.SOCKET_STREAM_NAME, '+', '-', 'COUNT', 1),
      ]);
      const tailId = tail.length > 0 ? tail[0][0] : null;
      let offsetExists = true;
      if (monitor.snapshot().offset) {
        const at = await redis.xrange(config.SOCKET_STREAM_NAME, monitor.snapshot().offset!, monitor.snapshot().offset!);
        offsetExists = at.length > 0;
      }
      monitor.observeStream(length, tailId, offsetExists);
      const snapshot = await publishSocketStreamMetrics(monitor, redis);
      if (snapshot.lagEntries >= config.SOCKET_ADAPTER_LAG_WARN_ENTRIES || snapshot.lagMs >= config.SOCKET_ADAPTER_LAG_WARN_MS) {
        logger.warn({ ...snapshot }, 'Socket stream: instance is falling behind the adapter stream');
      }
      if (monitor.consumeResync()) opts.onResync?.(snapshot);
    } catch (err) {
      logger.debug({ err: err instanceof Error ? err.message : err }, 'Socket stream: monitor sample failed');
    } finally {
      running = false;
    }
  };
  void sample();
  const timer = setInterval(() => void sample(), config.SOCKET_ADAPTER_MONITOR_MS);
  timer.unref?.();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
