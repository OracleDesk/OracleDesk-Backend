import http from 'http';
import { Server } from 'socket.io';
import app from './app';
import { config } from './config';
import { initSecrets, startSecretRefresh } from './config/secrets';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { startIngestionCron } from './cron/ingestion.cron';
import { startMonitorCron } from './cron/monitor.cron';
import { startTraceAuditCron } from './cron/trace-audit.cron';
import { startTracePublicationCron } from './cron/trace-publication.cron';
import { startEventListener } from './services/indexer.service';
import { getRedis, closeRedis } from './lib/redis';
import { health } from './services/health.service';
import {
  clientIp,
  isAllowedOrigin,
  redisConnectionLimiter,
  inboundEventLimiter,
  recordSocketRejection,
} from './lib/socket-limits';
import { SocketThrottle, attachSlowConsumerGuard } from './lib/socket-throttle';

let stopEventListener: (() => void) | null = null;
let stopSecretRefresh: (() => void) | null = null;
let throttle: SocketThrottle | null = null;
let stopSlowGuard: (() => void) | null = null;

const rejectionLogState = new Map<string, { count: number; lastLog: number }>();
function logSocketRejection(reason: string, details: Record<string, unknown> = {}): void {
  recordSocketRejection(reason);
  const now = Date.now();
  let state = rejectionLogState.get(reason);
  if (!state) {
    state = { count: 0, lastLog: 0 };
    rejectionLogState.set(reason, state);
  }
  state.count++;
  if (now - state.lastLog >= 10_000) {
    logger.warn({ reason, count: state.count, ...details }, `Socket connection rejected (${reason})`);
    state.count = 0;
    state.lastLog = now;
  }
}

async function bootstrap(): Promise<void> {
  // 0. Resolve secrets (mounted files or the configured remote provider).
  try {
    await initSecrets(config);
    stopSecretRefresh = startSecretRefresh(config);
  } catch (err) {
    logger.fatal({ err: err instanceof Error ? err.message : err }, 'Failed to initialise secrets');
    process.exit(1);
  }

  // 1. Connect to database
  try {
    await prisma.$connect();
    logger.info('Database connected');
  } catch (err) {
    logger.fatal({ err }, 'Failed to connect to database');
    process.exit(1);
  }

  if (config.ephemeralSecrets.length > 0) {
    logger.warn(
      { generated: config.ephemeralSecrets },
      'Generated ephemeral secrets for this process; sessions and challenges end on restart. Set them in .env.',
    );
  }
  logger.info({ mode: config.CHAIN_EXECUTION_MODE }, 'Chain execution mode');

  // 2. Start HTTP server with hardened Socket.io
  const server = http.createServer(app);
  const io = new Server(server, {
    transports: config.SOCKET_TRANSPORTS as any,
    maxHttpBufferSize: config.SOCKET_MAX_BUFFER_BYTES,
    pingInterval: 25_000,
    pingTimeout: 20_000,
    connectTimeout: 10_000,
    perMessageDeflate: false,
    cors: {
      origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
      methods: ['GET', 'POST'],
      credentials: true,
    },
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      if (origin && !isAllowedOrigin(origin)) {
        logSocketRejection('ORIGIN', { origin });
        return callback('ORIGIN_NOT_ALLOWED', false);
      }
      callback(null, true);
    },
  });

  const limiter = redisConnectionLimiter(getRedis(), {
    maxConnections: config.SOCKET_MAX_CONNECTIONS,
    maxPerIp: config.SOCKET_MAX_PER_IP,
    connectRatePerMin: config.SOCKET_CONNECT_RATE_PER_MIN,
    exemptCidrs: config.SOCKET_IP_EXEMPT_CIDRS,
  });

  io.engine.on('connection_error', (err: any) => {
    const origin = err.req?.headers?.origin;
    if (origin && !isAllowedOrigin(origin)) {
      logSocketRejection('ORIGIN', { origin });
    } else {
      logSocketRejection(err.message || 'HANDSHAKE_ERROR', { code: err.code });
    }
  });

  io.use(async (socket, next) => {
    const ip = clientIp(socket.request, config.TRUSTED_PROXIES);
    const result = await limiter.acquire(ip, socket.id);
    if (!result.ok) {
      logSocketRejection(result.reason, { ip, socketId: socket.id });
      return next(Object.assign(new Error('CONNECTION_LIMIT'), { data: { reason: result.reason } }));
    }

    socket.on('disconnect', () => {
      limiter.release(ip, socket.id).catch((err) => {
        logger.error({ err, socketId: socket.id }, 'Error releasing socket connection limit');
      });
      if (Math.random() < config.SOCKET_LOG_SAMPLE_RATE) {
        logger.info({ socketId: socket.id }, 'Client disconnected from socket.io');
      } else {
        logger.debug({ socketId: socket.id }, 'Client disconnected from socket.io');
      }
    });

    inboundEventLimiter(socket, {
      eventsPer10s: config.SOCKET_INBOUND_EVENTS_PER_10S,
    });

    next();
  });

  io.on('connection', (socket) => {
    if (Math.random() < config.SOCKET_LOG_SAMPLE_RATE) {
      logger.info({ socketId: socket.id }, 'New client connected to socket.io');
    } else {
      logger.debug({ socketId: socket.id }, 'New client connected to socket.io');
    }
  });

  // Slow consumer guard (Issue #96)
  const slowGuard = attachSlowConsumerGuard(io, {
    warnBytes: config.SOCKET_SLOW_WARN_BYTES,
    dropBytes: config.SOCKET_SLOW_DROP_BYTES,
    checkMs: config.SOCKET_SLOW_CHECK_MS,
  });
  stopSlowGuard = slowGuard.stop;

  // Socket throttle (Issue #96)
  throttle = new SocketThrottle(
    {
      emit: (event, payload, opts) => {
        if (opts.room) {
          const target = io.to(opts.room);
          if (opts.volatile) target.volatile.emit(event, payload);
          else target.emit(event, payload);
        } else {
          if (opts.volatile) io.volatile.emit(event, payload);
          else io.emit(event, payload);
        }
      },
    },
    {
      priceTickMs: config.SOCKET_PRICE_TICK_MS,
      tradeVolatile: config.SOCKET_TRADE_VOLATILE,
      dropHistorical: true,
    },
  );

  // 3. Index Stellar events (resumes from the stored ledger cursor)
  stopEventListener = startEventListener((event, payload, meta) => {
    throttle?.handle(event, payload, meta);
  });

  // 4. Start cron jobs
  startIngestionCron();
  startMonitorCron();
  startTraceAuditCron();
  startTracePublicationCron();

  // Make io accessible via app
  app.set('io', io);

  server.listen(config.PORT, () => {
    logger.info(
      { port: config.PORT, env: config.NODE_ENV },
      `OracleDesk backend running on port ${config.PORT}`,
    );
  });

  // ─── Graceful Shutdown ───
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down gracefully...');
    // Force exit if shutdown (drain + close) takes too long
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 15_000);
    // Report 503 from /readyz first so load balancers stop routing before the socket closes.
    health.startDraining();
    await new Promise((resolve) => setTimeout(resolve, config.SHUTDOWN_DRAIN_MS));
    const { triggerShutdown } = await import('./lib/shutdown');
    triggerShutdown();

    if (throttle) {
      throttle.flush();
      throttle.stop();
    }
    if (stopSlowGuard) stopSlowGuard();
    io.close();

    server.close(async () => {
      if (stopEventListener) stopEventListener();
      if (stopSecretRefresh) stopSecretRefresh();

      await prisma.$disconnect();
      await closeRedis();
      logger.info('Database disconnected');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled promise rejection');
  });

  process.on('uncaughtException', (err) => {
    health.markFatal();
    logger.fatal({ err }, 'Uncaught exception — shutting down');
    process.exit(1);
  });
}

bootstrap();
