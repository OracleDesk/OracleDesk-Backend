import http from 'http';
import { Server } from 'socket.io';
import app from './app';
import { config } from './config';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { startIngestionCron } from './cron/ingestion.cron';
import { startMonitorCron } from './cron/monitor.cron';
import { startEventListener, backfillEvents } from './services/indexer.service';

let stopEventListener: (() => void) | null = null;

async function bootstrap(): Promise<void> {
  // 1. Connect to database
  try {
    await prisma.$connect();
    logger.info('Database connected');
  } catch (err) {
    logger.fatal({ err }, 'Failed to connect to database');
    process.exit(1);
  }

  // 2. Backfill blockchain events missed during downtime
  backfillEvents().catch((err) => {
    logger.warn({ err }, 'Backfill failed');
  });

  // 3. Start real-time event listener
  stopEventListener = startEventListener();

  // 4. Start cron jobs
  startIngestionCron();
  startMonitorCron();

  // 5. Start HTTP server with Socket.io
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: '*', // In production, restrict this to your frontend URL
      methods: ['GET', 'POST'],
    },
  });

  io.on('connection', (socket) => {
    logger.info({ socketId: socket.id }, 'New client connected to socket.io');
    
    socket.on('disconnect', () => {
      logger.info({ socketId: socket.id }, 'Client disconnected from socket.io');
    });
  });

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

    server.close(async () => {
      if (stopEventListener) stopEventListener();

      await prisma.$disconnect();
      logger.info('Database disconnected');
      process.exit(0);
    });

    // Force exit if shutdown takes too long
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 15_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled promise rejection');
  });

  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception — shutting down');
    process.exit(1);
  });
}

bootstrap();
