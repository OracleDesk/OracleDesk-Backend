import http from 'http';
import { Server } from 'socket.io';
import { Keypair } from '@stellar/stellar-sdk';
import { createAdapter } from '@socket.io/redis-streams-adapter';
import app from './app';
import { config } from './config';
import { initSecrets, startSecretRefresh } from './config/secrets';
import { assertEmbeddingConfig } from './services/embeddings.service';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { startDisputeCron } from './cron/dispute.cron';
import { startIngestionCron } from './cron/ingestion.cron';
import { startMonitorCron } from './cron/monitor.cron';
import { startReportCron } from './cron/report.cron';
import { startReconcileCron } from './cron/reconcile.cron';
import { startMoneyAuditCron } from './cron/money-audit.cron';
import { startPriceResolutionCron } from './cron/price-resolution.cron';
import { bootstrapAdminRbac, isAdminToken } from './middlewares/auth.middleware';
import { bootstrapRiskParams, setRiskParamsEmitter } from './services/risk-params.service';
import { startTraceAuditCron } from './cron/trace-audit.cron';
import { startTracePublicationCron } from './cron/trace-publication.cron';
import { startPaymentIntentCron } from './cron/payment-intent.cron';
import { startOpsAlertCron } from './cron/ops-alerts.cron';
import { startEventListener } from './services/indexer.service';
import { gateDecision, runSpecCompatGate } from './services/stellar/spec-compat';
import { startOutboxWorker } from './services/stellar/outbox';
import { getChannelPool } from './services/stellar/channels';
import { resumeIncomplete } from './services/market-saga.service';
import { closeRedis, getRedis, checkRedisPolicy, releaseAllWaiters } from './lib/redis';
import { onShutdown, runShutdown } from './lib/shutdown-coordinator';
import { memoryEventBus, redisEventBus } from './lib/event-bus';
import { startFanout, startLocalFanout } from './lib/fanout';
import { setControlEmitter } from './services/agent-controls.service';
import { attachSessionLifecycle, setRealtime, socketAuthMiddleware } from './lib/socket-auth';
import { health } from './services/health.service';
import {
  clientIp,
  isAllowedOrigin,
  redisConnectionLimiter,
  inboundEventLimiter,
  recordSocketRejection,
} from './lib/socket-limits';
import { SocketThrottle, attachSlowConsumerGuard } from './lib/socket-throttle';
import { planForRole, startProbeServer } from './lib/process-role';

let stopEventListener: (() => void) | null = null;
let stopFanout: (() => Promise<void>) | null = null;
let stopSecretRefresh: (() => void) | null = null;
let throttle: SocketThrottle | null = null;
let stopSlowGuard: (() => void) | null = null;
let stopOutboxWorker: (() => void) | null = null;
let stopOpsAlerts: (() => void) | null = null;

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

  // 0b. A dimension the markets.questionEmbedding column cannot hold fails here, not on the first insert.
  try {
    assertEmbeddingConfig();
  } catch (err) {
    logger.fatal({ err: err instanceof Error ? err.message : err }, 'Invalid embedding configuration');
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
  const rolePlan = planForRole(config.PROCESS_ROLE);
  logger.info({ role: config.PROCESS_ROLE, mode: config.CHAIN_EXECUTION_MODE }, 'Booting process role');

  // Seed the fixed RBAC catalogue and first-deploy admins from ADMIN_ADDRESSES.
  if (rolePlan.startBootstrapRbac) {
    try {
      await bootstrapAdminRbac();
      await bootstrapRiskParams();
    } catch (err) {
      logger.fatal({ err }, 'Failed to initialise admin RBAC');
      process.exit(1);
    }
  }

  // #50: challenges must not be evicted before their TTL, and non-TTL data
  // (locks, queues) shares this Redis. Warn on a policy that evicts them.
  await checkRedisPolicy();

  // Initialise the cached agent sequence before any live write can race (#36).
  if (rolePlan.startSequenceSync && config.CHAIN_EXECUTION_MODE === 'live' && config.AGENT_SECRET_KEY) {
    try {
      const { syncSequence } = await import('./services/stellar/sequence');
      const agent = Keypair.fromSecret(config.AGENT_SECRET_KEY).publicKey();
      const sequence = await syncSequence(agent);
      logger.info({ agent, sequence: sequence.toString() }, 'Agent sequence cache initialised');
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : err }, 'Could not initialise the agent sequence cache; live writes will resync on first use');
    }
  }

  // 1b. Contract spec compatibility gate (#34): verify the deployed contracts
  // still run what the synced bindings were generated from, before anything
  // simulates calls or decodes events against those bindings. Live mode
  // refuses to start on breaking drift; dry-run warns and keeps running.
  const specCompat = await runSpecCompatGate();
  if (specCompat && gateDecision(specCompat, specCompat.mode) === 'refuse') {
    process.exit(1);
  }

  // 1c. Transaction outbox recovery (#35): resolve whatever a previous process
  // left in flight before the indexer and crons start issuing new writes, then
  // keep recovering on an interval (one instance at a time via a Redis lock).
  if (rolePlan.startOutbox) {
    stopOutboxWorker = startOutboxWorker();
    // Channel balances feed the pool's healthy flags and the channels probe
    // (#220). Only writer roles lease channels; the monitor is a no-op in dry-run.
    if (config.CHAIN_EXECUTION_MODE === 'live') getChannelPool().startBalanceMonitor();
  }

  // 1d. Market generation saga (#242): resume runs a previous process left
  // mid-way. Background: a slow LLM step must not delay boot.
  if (rolePlan.startSagaResume) {
    void resumeIncomplete().catch((err) => logger.warn({ err }, 'Saga resume on boot failed'));
  }

  let io: Server | null = null;
  let probeServer: http.Server | null = null;
  const bus = config.EVENT_BUS_ENABLED ? redisEventBus() : memoryEventBus();

  // 2. Start HTTP server with hardened Socket.io (api / all roles only)
  if (rolePlan.startHttpAndSockets) {
    const server = http.createServer(app);
    io = new Server(server, {
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

    // Authenticated sockets (#94) and cluster-wide broadcast (#93).
    io.use(socketAuthMiddleware());
    attachSessionLifecycle(io);
    setRealtime(io);
    if (config.EVENT_BUS_ENABLED) {
      io.adapter(createAdapter(getRedis(), { streamName: 'oracledesk:socket.io', blockTimeInMs: 1000 }));
    } else {
      logger.warn('EVENT_BUS_ENABLED=false: in-process event bus; socket events reach this instance only');
    }

    // Slow consumer guard (Issue #96)
    const slowGuard = attachSlowConsumerGuard(io, {
      warnBytes: config.SOCKET_SLOW_WARN_BYTES,
      dropBytes: config.SOCKET_SLOW_DROP_BYTES,
      checkMs: config.SOCKET_SLOW_CHECK_MS,
    });
    stopSlowGuard = slowGuard.stop;

    // Socket throttle (Issue #96)
    const activeIo = io;
    throttle = new SocketThrottle(
      {
        emit: (event, payload, opts) => {
          if (opts.room) {
            const target = activeIo.to(opts.room);
            if (opts.volatile) target.volatile.emit(event, payload);
            else target.emit(event, payload);
          } else {
            if (opts.volatile) activeIo.volatile.emit(event, payload);
            else activeIo.emit(event, payload);
          }
        },
      },
      {
        priceTickMs: config.SOCKET_PRICE_TICK_MS,
        tradeVolatile: config.SOCKET_TRADE_VOLATILE,
        dropHistorical: true,
      },
    );

    if (rolePlan.startFanout) {
      stopFanout = config.EVENT_BUS_ENABLED ? startFanout(bus, io) : startLocalFanout(bus, io);
    }

    // Make io accessible via app
    app.set('io', io);
    setControlEmitter((event, payload) => activeIo.emit(event, payload));
    setRiskParamsEmitter((event, payload) => activeIo.to('admins').emit(event, payload));

    io.on('connection', async (socket) => {
      if (Math.random() < config.SOCKET_LOG_SAMPLE_RATE) {
        logger.info({ socketId: socket.id }, 'New client connected to socket.io');
      } else {
        logger.debug({ socketId: socket.id }, 'New client connected to socket.io');
      }
      if (await isAdminToken(socket.handshake.auth?.token)) void socket.join('admins');
    });

    server.listen(config.PORT, () => {
      logger.info(
        { port: config.PORT, env: config.NODE_ENV, role: config.PROCESS_ROLE },
        `OracleDesk backend running on port ${config.PORT}`,
      );
    });
  }

  // 3. Index Stellar events (resumes from the stored ledger cursor). The
  // indexer publishes to the bus; api pods fan out to connected sockets.
  if (rolePlan.startIndexer) {
    // Sockets are fed by the bus fan-out (#93), not from here. The #96 throttle
    // used to sit on this callback, but PublishMeta carries no `live` flag, so
    // it dropped every event as historical; it was never reaching clients.
    stopEventListener = startEventListener(async (type, payload, meta) => {
      await bus.publish({ ...meta, type, payload });
    });
  }

  // 4. Start cron jobs (worker / all roles only)
  if (rolePlan.startCrons) {
    startIngestionCron();
    startMonitorCron();
    startReportCron();
    startTraceAuditCron();
    startTracePublicationCron();
    startPaymentIntentCron();
    startDisputeCron();
    // Drift reports reach admins only: sockets join the room with an admin JWT.
    startReconcileCron((event, payload) => {
      if (io) io.to('admins').emit(event, payload);
    });
    // Money records vs outbox and on-chain treasury shares (#222).
    startMoneyAuditCron();
    // Price-mode reveal + resolve loop (#90).
    startPriceResolutionCron();
    // Operational alerts (#226): one evaluator per tick via an advisory lock.
    stopOpsAlerts = startOpsAlertCron();
  }

  // Minimal health probe listener for non-API roles (indexer / worker).
  if (rolePlan.startProbeOnlyServer) {
    probeServer = startProbeServer(config.PORT, () => {
      logger.info(
        { port: config.PORT, env: config.NODE_ENV, role: config.PROCESS_ROLE },
        `OracleDesk probe server running on port ${config.PORT}`,
      );
    });
  }

  // ─── Shutdown coordinator registrations (#264) ───────────────────────────
  onShutdown('stop-intake', 'event-listener', async () => { stopEventListener?.(); }, 2_000);
  onShutdown('stop-producers', 'outbox-worker', async () => { stopOutboxWorker?.(); }, 3_000);
  onShutdown('stop-producers', 'fanout', async () => { if (stopFanout) await stopFanout(); }, 5_000);
  onShutdown('stop-producers', 'secret-refresh', async () => { stopSecretRefresh?.(); }, 1_000);
  onShutdown('stop-producers', 'ops-alerts', async () => { stopOpsAlerts?.(); }, 1_000);
  onShutdown('release-leases', 'redis-waiters', async () => { await releaseAllWaiters(); }, 2_000);
  onShutdown('close-transports', 'prisma', async () => { await prisma.$disconnect(); }, 5_000);
  onShutdown('close-transports', 'redis', async () => { await closeRedis(); }, 3_000);

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

    const report = await runShutdown(12_000);
    logger.info({ report }, 'shutdown-coordinator: completed');

    if (io) {
      io.close(() => {
        logger.info('HTTP server closed');
        process.exit(0);
      });
    } else if (probeServer) {
      probeServer.close(() => {
        logger.info('Probe server closed');
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
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
