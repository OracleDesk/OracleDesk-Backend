import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import hpp from 'hpp';

import { config } from './config';
import { logger } from './lib/logger';
import { errorMiddleware } from './middlewares/error.middleware';
import router from './routes';
import { acknowledgeCircleWebhook, handleCircleWebhook } from './controllers/webhook.controller';

const app = express();

// ─── Security ───
app.use(helmet());
app.use(hpp());
app.use(cors({
  origin: (origin, callback) => {
    const allowedOrigins = [
      'https://oracledesk.app',
      'https://oracle-desk-frontend.vercel.app',
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:3002',
      'http://localhost:3003',
      'http://localhost:3004',
      'http://localhost:3005',
    ];
    
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1 || config.NODE_ENV !== 'production') {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

// Circle requires the exact raw JSON payload for webhook signature verification.
app.head('/api/v1/webhooks/circle', acknowledgeCircleWebhook);
app.post('/api/v1/webhooks/circle', express.raw({ type: 'application/json' }), handleCircleWebhook);

// ─── Rate Limiting ───
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max:      200,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { ok: false, data: null, error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
}));

// ─── Body Parsing + Compression ───
app.use(compression());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── HTTP Logging ───
app.use(
  morgan('combined', {
    stream: { write: (msg) => logger.info(msg.trim()) },
    skip:   () => config.NODE_ENV === 'test',
  }),
);

// ─── Health Check ───
app.get('/health', (_req, res) => {
  res.json({ ok: true, data: { status: 'healthy', uptime: process.uptime() }, error: null });
});

// ─── API Routes ───
app.use('/api/v1', router);

// ─── 404 Handler ───
app.use((_req, res) => {
  res.status(404).json({
    ok: false,
    data: null,
    error: { code: 'NOT_FOUND', message: 'Route not found' },
  });
});

// ─── Global Error Handler ───
app.use(errorMiddleware);

export default app;
