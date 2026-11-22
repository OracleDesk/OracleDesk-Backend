import type { Server } from 'socket.io';
import { logger } from './logger';

export interface Sink {
  emit(event: string, payload: unknown, opts: { volatile: boolean; room?: string }): void;
}

export interface ThrottleOptions {
  priceTickMs: number;
  tradeVolatile: boolean;
  dropHistorical: boolean;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => unknown;
}

export interface MarketPricePayload {
  onChainMarketId: string;
  marketId: string | null;
  priceYesBps: number;
  ledger: number;
  eventId: string;
  ts: number;
}

export class SocketThrottle {
  private sink: Sink;
  private opts: ThrottleOptions;
  private now: () => number;
  private schedule: (fn: () => void, ms: number) => unknown;

  private pendingPrices = new Map<string, MarketPricePayload>();
  private activeTimers = new Map<string, unknown>();
  private lastEmittedAt = new Map<string, number>();
  private lastEmittedLedger = new Map<string, number>();
  private lagging = false;

  private coalescedCount = 0;
  private droppedHistoricalCount = 0;
  private catchupCount = 0;
  private emittedCounts: Record<string, number> = {};

  constructor(sink: Sink, opts: ThrottleOptions) {
    this.sink = sink;
    this.opts = opts;
    this.now = opts.now ?? (() => Date.now());
    this.schedule = opts.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  }

  private incrementEmitted(event: string): void {
    this.emittedCounts[event] = (this.emittedCounts[event] ?? 0) + 1;
  }

  public handle(
    event: string,
    payload: any,
    meta: { live: boolean; ledger: number; marketKey: string | null },
  ): void {
    // The indexer marks an event live only when it is within
    // SOCKET_LIVE_LEDGER_LAG of the RPC tip (#291). Every lagging -> live
    // transition produces exactly one CATCHUP_COMPLETE for the clients.
    if (!meta.live) {
      this.lagging = true;
    } else if (this.lagging) {
      this.lagging = false;
      if (event !== 'CATCHUP_COMPLETE') {
        this.catchupCount++;
        this.sink.emit(
          'CATCHUP_COMPLETE',
          { ledger: meta.ledger, live: true },
          { volatile: false },
        );
        this.incrementEmitted('CATCHUP_COMPLETE');
      }
    }

    if (!meta.live && this.opts.dropHistorical && event !== 'CATCHUP_COMPLETE') {
      this.droppedHistoricalCount++;
      return;
    }

    if (event === 'TRADE_EXECUTED') {
      const marketKey = meta.marketKey || payload?.onChainMarketId || payload?.marketId || 'unknown';
      const lastLedger = this.lastEmittedLedger.get(marketKey) ?? 0;

      // Drop pending update older than the last emitted ledger for that market
      if (payload?.ledger !== undefined && payload.ledger < lastLedger) {
        this.coalescedCount++;
      } else {
        const existing = this.pendingPrices.get(marketKey);
        if (existing) {
          // Compare ledger, then eventId string
          const isNewer =
            payload.ledger > existing.ledger ||
            (payload.ledger === existing.ledger && String(payload.eventId) >= String(existing.eventId));
          if (isNewer) {
            this.pendingPrices.set(marketKey, {
              onChainMarketId: String(payload.onChainMarketId),
              marketId: payload.marketId ?? null,
              priceYesBps: Number(payload.priceYesBps),
              ledger: Number(payload.ledger),
              eventId: String(payload.eventId),
              ts: this.now(),
            });
          }
          this.coalescedCount++;
        } else {
          this.pendingPrices.set(marketKey, {
            onChainMarketId: String(payload.onChainMarketId),
            marketId: payload.marketId ?? null,
            priceYesBps: Number(payload.priceYesBps),
            ledger: Number(payload.ledger),
            eventId: String(payload.eventId),
            ts: this.now(),
          });

          const lastEmit = this.lastEmittedAt.get(marketKey) ?? 0;
          const elapsed = this.now() - lastEmit;
          const delay = Math.max(0, this.opts.priceTickMs - elapsed);

          const timer = this.schedule(() => this.flushMarket(marketKey), delay);
          this.activeTimers.set(marketKey, timer);
        }
      }

      // Emit trade itself to realtime:full room
      this.sink.emit('TRADE_EXECUTED', payload, {
        volatile: this.opts.tradeVolatile,
        room: 'realtime:full',
      });
      this.incrementEmitted('TRADE_EXECUTED');
      return;
    }

    if (event === 'REASONING_PUBLISHED') {
      this.sink.emit('REASONING_PUBLISHED', payload, { volatile: false });
      this.incrementEmitted('REASONING_PUBLISHED');
      return;
    }

    if (event === 'CATCHUP_COMPLETE') {
      this.sink.emit('CATCHUP_COMPLETE', payload, { volatile: false });
      this.incrementEmitted('CATCHUP_COMPLETE');
      return;
    }

    this.sink.emit(event, payload, { volatile: false });
    this.incrementEmitted(event);
  }

  private flushMarket(marketKey: string): void {
    this.clearScheduledTimer(marketKey);
    const update = this.pendingPrices.get(marketKey);
    if (!update) return;

    this.pendingPrices.delete(marketKey);
    this.lastEmittedAt.set(marketKey, this.now());
    this.lastEmittedLedger.set(marketKey, update.ledger);

    this.sink.emit('MARKET_PRICE', update, { volatile: false });
    this.incrementEmitted('MARKET_PRICE');
  }

  private clearScheduledTimer(marketKey: string): void {
    const timer = this.activeTimers.get(marketKey);
    if (timer) {
      if (typeof timer === 'number' || typeof timer === 'object') {
        clearTimeout(timer as NodeJS.Timeout);
      }
      this.activeTimers.delete(marketKey);
    }
  }

  public flush(): void {
    for (const marketKey of Array.from(this.pendingPrices.keys())) {
      this.flushMarket(marketKey);
    }
  }

  public stop(): void {
    for (const marketKey of Array.from(this.activeTimers.keys())) {
      this.clearScheduledTimer(marketKey);
    }
    this.pendingPrices.clear();
  }

  public stats(): {
    coalesced: number;
    droppedHistorical: number;
    catchup: number;
    lagging: boolean;
    emitted: Record<string, number>;
  } {
    return {
      coalesced: this.coalescedCount,
      droppedHistorical: this.droppedHistoricalCount,
      catchup: this.catchupCount,
      lagging: this.lagging,
      emitted: { ...this.emittedCounts },
    };
  }
}

export interface SlowConsumerGuardOptions {
  warnBytes: number;
  dropBytes: number;
  checkMs: number;
}

function packetBytes(packet: unknown): number {
  if (packet == null) return 0;
  if (Buffer.isBuffer(packet)) return packet.length;
  if (typeof packet === 'string') return Buffer.byteLength(packet);
  if (typeof packet === 'object') {
    const p = packet as { data?: unknown; length?: unknown };
    if (typeof p.length === 'number') return p.length;
    if (typeof p.data === 'string') return Buffer.byteLength(p.data);
    if (Buffer.isBuffer(p.data)) return p.data.length;
  }
  return 0;
}

/**
 * Real queued bytes for a socket: engine.io's own writeBuffer plus the
 * WebSocket (or polling) transport buffer. `bufferedAmount` alone misses
 * long-polling clients and packets still queued in engine.io (#291).
 */
export function socketBufferedBytes(socket: any): number {
  let bytes = 0;
  const conn = socket?.conn;
  const seen = new Set<unknown>();
  const addBuffer = (buffer: unknown) => {
    if (!Array.isArray(buffer) || seen.has(buffer)) return;
    seen.add(buffer);
    for (const packet of buffer) bytes += packetBytes(packet);
  };
  try {
    const transport = conn?.transport;
    const raw = transport?.socket;
    if (typeof raw?.bufferedAmount === 'number') bytes += raw.bufferedAmount;
    if (typeof raw?.writableLength === 'number') bytes += raw.writableLength;
    addBuffer(conn?.writeBuffer);
    addBuffer(transport?.writeBuffer);
    if (typeof conn?.writableLength === 'number') bytes += conn.writableLength;
    if (typeof transport?.writableLength === 'number') bytes += transport.writableLength;
  } catch {
    /* a transport can disappear between checks */
  }
  return bytes;
}

export function attachSlowConsumerGuard(
  io: Server | any,
  opts: SlowConsumerGuardOptions,
): { stop(): void } {
  // Ensure all connecting sockets join the realtime:full room
  if (typeof io.on === 'function') {
    io.on('connection', (socket: any) => {
      socket.join('realtime:full');
    });
  }

  const checkSockets = () => {
    try {
      const socketMap = io.of ? io.of('/').sockets : io.sockets?.sockets;
      if (!socketMap) return;

      const sockets = socketMap.values ? Array.from(socketMap.values()) : Object.values(socketMap);
      for (const socket of sockets as any[]) {
        const bufferedBytes = socketBufferedBytes(socket);

        if (bufferedBytes >= opts.dropBytes) {
          logger.warn(
            { socketId: socket.id, bufferedBytes, dropBytes: opts.dropBytes },
            'Slow consumer dropped: exceeded dropBytes buffer threshold',
          );
          socket.disconnect(true);
        } else if (bufferedBytes >= opts.warnBytes) {
          if (typeof socket.leave === 'function') {
            socket.leave('realtime:full');
          }
        } else {
          if (typeof socket.join === 'function') {
            socket.join('realtime:full');
          }
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error in slow-consumer guard check');
    }
  };

  const timer = setInterval(checkSockets, opts.checkMs);

  return {
    stop: () => clearInterval(timer),
  };
}
