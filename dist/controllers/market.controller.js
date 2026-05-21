"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listMarkets = listMarkets;
exports.getMarket = getMarket;
exports.triggerMarketGeneration = triggerMarketGeneration;
exports.getMarketGenerationStatus = getMarketGenerationStatus;
const prisma_1 = require("../lib/prisma");
const uuid_1 = require("uuid");
const types_1 = require("../types");
const response_util_1 = require("../utils/response.util");
const market_maker_agent_1 = require("../agents/market-maker.agent");
const market_validator_1 = require("../validators/market.validator");
const jobTracker = new Map();
/**
 * GET /markets
 * Returns a paginated list of prediction markets.
 * Query params: status, category, currency, page, limit
 */
async function listMarkets(req, res) {
    const parsed = market_validator_1.listMarketsSchema.safeParse({
        query: req.query,
    });
    if (!parsed.success) {
        (0, response_util_1.sendError)(res, 400, 'VALIDATION_ERROR', 'Invalid query parameters', parsed.error.flatten().fieldErrors);
        return;
    }
    const { status, category, currency, page: p, limit: l, } = parsed.data.query;
    const { page, limit, skip } = (0, response_util_1.parsePagination)({
        page: p,
        limit: l,
    });
    const where = {
        ...(status
            ? { status: status }
            : {}),
        ...(category
            ? { category: category }
            : {}),
        ...(currency
            ? {
                settlementCurrency: currency,
            }
            : {}),
    };
    const [markets, total] = await Promise.all([
        prisma_1.prisma.market.findMany({
            where,
            skip,
            take: limit,
            orderBy: {
                createdAt: 'desc',
            },
            include: {
                _count: {
                    select: {
                        trades: true,
                        reasoningTraces: true,
                    },
                },
            },
        }),
        prisma_1.prisma.market.count({ where }),
    ]);
    (0, response_util_1.sendSuccess)(res, markets, 200, (0, response_util_1.buildPaginationMeta)(page, limit, total));
}
/**
 * GET /markets/:id
 * Returns full detail for a single market including confidence interval
 * and linked reasoning traces.
 */
async function getMarket(req, res) {
    const id = String(req.params.id);
    const market = await prisma_1.prisma.market.findUnique({
        where: { id },
        include: {
            reasoningTraces: {
                orderBy: {
                    createdAt: 'desc',
                },
                take: 5,
                select: {
                    id: true,
                    agentType: true,
                    edge: true,
                    probabilityEstimate: true,
                    verified: true,
                    createdAt: true,
                },
            },
            _count: {
                select: {
                    trades: true,
                    positions: true,
                },
            },
        },
    });
    if (!market) {
        (0, response_util_1.sendError)(res, 404, 'MARKET_NOT_FOUND', `Market ${id} not found`);
        return;
    }
    (0, response_util_1.sendSuccess)(res, market);
}
/**
 * POST /markets/generate
 * Manually trigger one Market Maker Agent cycle.
 * Used for hackathon demos and testing.
 * Requires auth.
 */
async function triggerMarketGeneration(req, res) {
    const jobId = (0, uuid_1.v4)();
    // ── Register RUNNING job ─────────────────────────────────────
    jobTracker.set(jobId, {
        status: types_1.JobStatus.RUNNING,
        startedAt: new Date(),
    });
    // ── Persist audit log ────────────────────────────────────────
    prisma_1.prisma.agentLog
        .create({
        data: {
            agentType: 'MARKET_MAKER',
            level: 'INFO',
            action: 'GENERATION_JOB_STARTED',
            data: {
                jobId,
            },
        },
    })
        .catch(() => {
        // Non-blocking
    });
    // ── Run generation in background ─────────────────────────────
    (0, market_maker_agent_1.runMarketMakerCycle)()
        .then((result) => {
        const existingJob = jobTracker.get(jobId);
        if (!existingJob) {
            return;
        }
        jobTracker.set(jobId, {
            status: types_1.JobStatus.COMPLETED,
            startedAt: existingJob.startedAt,
            completedAt: new Date(),
            marketId: result?.marketId,
            question: result?.question,
            category: result?.category,
        });
    })
        .catch((err) => {
        const existingJob = jobTracker.get(jobId);
        if (!existingJob) {
            return;
        }
        jobTracker.set(jobId, {
            status: types_1.JobStatus.FAILED,
            startedAt: existingJob.startedAt,
            completedAt: new Date(),
            error: err.message,
        });
    });
    (0, response_util_1.sendSuccess)(res, {
        jobId,
        message: 'Market Maker cycle started. Gemini is analysing live signals.',
        statusUrl: `/api/v1/markets/generation-status/${jobId}`,
        hint: 'Poll statusUrl every 5 seconds until status is COMPLETED or FAILED.',
    }, 202);
}
/**
 * GET /api/v1/markets/generation-status/:jobId
 *
 * Poll background job status.
 */
async function getMarketGenerationStatus(req, res) {
    const { jobId } = req.params;
    if (!jobId || typeof jobId !== 'string') {
        (0, response_util_1.sendError)(res, 400, 'INVALID_JOB_ID', 'jobId must be a non-empty string');
        return;
    }
    // ── Check memory tracker ─────────────────────────────────────
    const job = jobTracker.get(jobId);
    if (job) {
        const elapsedMs = job.completedAt
            ? job.completedAt.getTime() - job.startedAt.getTime()
            : Date.now() - job.startedAt.getTime();
        (0, response_util_1.sendSuccess)(res, {
            jobId,
            status: job.status,
            startedAt: job.startedAt,
            completedAt: job.completedAt ?? null,
            elapsedMs,
            ...(job.marketId
                ? {
                    marketId: job.marketId,
                    question: job.question,
                    category: job.category,
                    marketUrl: `/api/v1/markets/${job.marketId}`,
                }
                : {}),
            ...(job.error
                ? {
                    error: job.error,
                }
                : {}),
        });
        return;
    }
    // ── Check persisted DB logs ──────────────────────────────────
    const dbLog = await prisma_1.prisma.agentLog.findFirst({
        where: {
            action: 'GENERATION_JOB_STARTED',
            data: {
                path: ['jobId'],
                equals: jobId,
            },
        },
        orderBy: {
            createdAt: 'desc',
        },
    });
    if (!dbLog) {
        (0, response_util_1.sendError)(res, 404, 'JOB_NOT_FOUND', `No generation job found with id: ${jobId}`);
        return;
    }
    // ── Job existed before restart ───────────────────────────────
    (0, response_util_1.sendSuccess)(res, {
        jobId,
        status: types_1.JobStatus.UNKNOWN,
        startedAt: dbLog.createdAt,
        message: 'Server restarted after this job started. Check recent markets.',
        hint: 'Filter GET /api/v1/markets by recent createdAt timestamps.',
    });
}
