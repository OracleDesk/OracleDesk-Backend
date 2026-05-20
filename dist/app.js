"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const compression_1 = __importDefault(require("compression"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const morgan_1 = __importDefault(require("morgan"));
const hpp_1 = __importDefault(require("hpp"));
const config_1 = require("./config");
const logger_1 = require("./lib/logger");
const error_middleware_1 = require("./middlewares/error.middleware");
const routes_1 = __importDefault(require("./routes"));
const webhook_controller_1 = require("./controllers/webhook.controller");
const app = (0, express_1.default)();
// ─── Security ───
app.use((0, helmet_1.default)());
app.use((0, hpp_1.default)());
app.use((0, cors_1.default)({
    origin: config_1.config.NODE_ENV === 'production' ? 'https://oracledesk.app' : '*',
    credentials: true,
}));
// Circle requires the exact raw JSON payload for webhook signature verification.
app.head('/api/v1/webhooks/circle', webhook_controller_1.acknowledgeCircleWebhook);
app.post('/api/v1/webhooks/circle', express_1.default.raw({ type: 'application/json' }), webhook_controller_1.handleCircleWebhook);
// ─── Rate Limiting ───
app.use((0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, data: null, error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
}));
// ─── Body Parsing + Compression ───
app.use((0, compression_1.default)());
app.use(express_1.default.json({ limit: '5mb' }));
app.use(express_1.default.urlencoded({ extended: true }));
// ─── HTTP Logging ───
app.use((0, morgan_1.default)('combined', {
    stream: { write: (msg) => logger_1.logger.info(msg.trim()) },
    skip: () => config_1.config.NODE_ENV === 'test',
}));
// ─── Health Check ───
app.get('/health', (_req, res) => {
    res.json({ ok: true, data: { status: 'healthy', uptime: process.uptime() }, error: null });
});
// ─── API Routes ───
app.use('/api/v1', routes_1.default);
// ─── 404 Handler ───
app.use((_req, res) => {
    res.status(404).json({
        ok: false,
        data: null,
        error: { code: 'NOT_FOUND', message: 'Route not found' },
    });
});
// ─── Global Error Handler ───
app.use(error_middleware_1.errorMiddleware);
exports.default = app;
