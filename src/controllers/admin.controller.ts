import type { Request, Response } from 'express';
import { z } from 'zod';
import { sendSuccess, parsePagination, buildPaginationMeta } from '../utils/response.util';
import {
  controlScopeSchema,
  createOperationSchema,
  moneyAuditRunSchema,
  pauseAgentSchema,
  reconcileRunSchema,
  recordSchema,
  resumeAgentSchema,
  signatureSchema,
} from '../validators/admin.validator';
import { controlsOverview, pauseAgent, resumeAgent } from '../services/agent-controls.service';
import { defaultDeps, runReconciliation } from '../services/market-reconciler.service';
import { runMoneyAudit } from '../services/money-audit/run';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../lib/prisma';
import { AgentDecisionKind, AgentDecisionReason, AgentType, TraceAuditStatus } from '@prisma/client';
import { runTraceAudit } from '../services/trace-audit.service';
import { sendError } from '../utils/response.util';
import { logger } from '../lib/logger';
import { config } from '../config';
import { secret } from '../config/secrets';
import { chainWritesStatus, health } from '../services/health.service';
import { socketStreamClusterStats } from '../lib/socket-stream';
import { indexerStatus, CURSOR_ID } from '../services/indexer.service';
import { Keypair } from '@stellar/stellar-sdk';
import { agentSigner } from '../services/stellar/clients';
import { acknowledgeSpecDrift, getSpecCompatHistory } from '../services/stellar/spec-monitor';
import { getFeeOracle } from '../services/stellar/fees';
import { spendSnapshot } from '../services/stellar/fee-spend';
import { getChainCache } from '../lib/chain-cache';
import { getLlmUsage } from '../lib/llm-budget';
import { getBulkheadStats } from '../lib/resilience';
import { getCronStatus } from '../cron/registry';
import { MAX_SILENCE_MINUTES, acknowledgeIncident, listIncidents, silenceIncident } from '../services/ops-alerts/incidents';
import { getReplicationSummary } from '../jobs/ipfs-replication.job';
import {
  ensureSigningKeyRegistered,
  retireSigningKey,
  signingKeyStatus,
} from '../services/agent-signing-key.service';
import { AppError } from '../middlewares/error.middleware';
import * as sourceWeights from '../services/source-weights.service';
import {
  ADMIN_ROLES,
  grantAdminRole,
  isAdminAddress,
  isAdminRole,
  listAdminAudit,
  listAdmins,
  listRoles,
  revokeAdminRole,
} from '../services/admin-rbac.service';
import {
  acknowledge,
  buildGuardianTx,
  listDisputes,
} from '../services/dispute-monitor.service';
import { getPriceMarketsHealthOverview } from '../services/price-feed-monitor.service';
import {
  addSignature,
  cancelOperation,
  getOperation,
  getSep7Status,
  getTreasuryState,
  issueSep7Requests,
  listOperations,
  prepareOperation,
  recordSubmitted,
  submitOperation,
} from '../services/treasury-ops.service';
import { outboxActionSchema, outboxIdSchema, outboxListQuerySchema } from '../validators/admin.validator';
import { abandon, listOutbox, outboxDetail, recoverNow, rerunHandler } from '../services/outbox-admin.service';

function actor(req: Request): string {
  if (!req.user) throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
  return req.user.walletAddress;
}

export async function getTreasury(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await getTreasuryState());
}

export async function createOperation(req: Request, res: Response): Promise<void> {
  const parsed = createOperationSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid operation', parsed.error.flatten().fieldErrors as any);
  }
  const prepared = await prepareOperation(parsed.data.operation, actor(req));
  sendSuccess(res, prepared, 201);
}

export async function listTreasuryOperations(req: Request, res: Response): Promise<void> {
  const { page, limit } = parsePagination(req.query as any);
  const { rows, total } = await listOperations(page, limit);
  sendSuccess(res, rows, 200, buildPaginationMeta(page, limit, total) as any);
}

export async function getTreasuryOperation(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await getOperation(String(req.params.id)));
}

export async function addOperationSignature(req: Request, res: Response): Promise<void> {
  const parsed = signatureSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError(400, 'VALIDATION_ERROR', 'signedXdr is required', parsed.error.flatten().fieldErrors as any);
  }
  sendSuccess(res, await addSignature(String(req.params.id), parsed.data.signedXdr, actor(req)));
}

export async function submitTreasuryOperation(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await submitOperation(String(req.params.id)));
}

export async function recordTreasuryOperation(req: Request, res: Response): Promise<void> {
  const parsed = recordSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError(400, 'VALIDATION_ERROR', 'txHash is required', parsed.error.flatten().fieldErrors as any);
  }
  await recordSubmitted(String(req.params.id), parsed.data.txHash, actor(req));
  sendSuccess(res, { recorded: true });
}

export async function cancelTreasuryOperation(req: Request, res: Response): Promise<void> {
  await cancelOperation(String(req.params.id), actor(req));
  sendSuccess(res, { cancelled: true });
}

export async function issueOperationSep7(req: Request, res: Response): Promise<void> {
  const issued = await issueSep7Requests(String(req.params.id), actor(req));
  sendSuccess(res, { requests: issued }, 201);
}

export async function getOperationSep7Status(req: Request, res: Response): Promise<void> {
  const requests = await getSep7Status(String(req.params.id));
  sendSuccess(res, { requests });
}

export async function getChainSigningKeys(_req: Request, res: Response): Promise<void> {
  sendSuccess(res, await signingKeyStatus());
}

export async function registerChainSigningKey(req: Request, res: Response): Promise<void> {
  const mode = req.body?.mode === 'prepare' ? 'prepare' : 'submit';
  const result = await ensureSigningKeyRegistered({ mode });
  await prisma.agentLog
    .create({
      data: {
        agentType: 'MARKET_MAKER',
        level: 'INFO',
        action: 'SIGNING_KEY_REGISTERED',
        data: { actor: actor(req), mode, publicKey: result.publicKey, alreadyActive: Boolean(result.alreadyActive) } as object,
      },
    })
    .catch(() => {});
  sendSuccess(res, result, 201);
}

export async function retireChainSigningKey(req: Request, res: Response): Promise<void> {
  const mode = req.body?.mode === 'prepare' ? 'prepare' : 'submit';
  const publicKey = String(req.params.publicKey ?? '').trim();
  const result = await retireSigningKey(publicKey, { mode });
  await prisma.agentLog
    .create({
      data: {
        agentType: 'MARKET_MAKER',
        level: 'INFO',
        action: 'SIGNING_KEY_RETIRED',
        data: { actor: actor(req), mode, publicKey: result.publicKey } as object,
      },
    })
    .catch(() => {});
  sendSuccess(res, result);
}

/** GET /admin/agents/controls: effective state per scope plus the last 20 audit events. */
export async function getAgentControls(_req: Request, res: Response): Promise<void> {
  sendSuccess(res, await controlsOverview());
}

function agentParam(req: Request) {
  const scope = controlScopeSchema.safeParse(String(req.params.agent));
  if (!scope.success) {
    throw new AppError(400, 'VALIDATION_ERROR', 'agent must be one of ALL, MARKET_MAKER, TRADER');
  }
  return scope.data;
}

/** POST /admin/agents/:agent/pause: indefinite unless `until` is given. */
export async function pauseAgentControl(req: Request, res: Response): Promise<void> {
  const scope = agentParam(req);
  const body = pauseAgentSchema.safeParse(req.body);
  if (!body.success) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid pause request', body.error.flatten().fieldErrors as any);
  }
  const until = body.data.until ? new Date(body.data.until) : undefined;
  if (until && until.getTime() <= Date.now()) {
    throw new AppError(400, 'VALIDATION_ERROR', 'until must be in the future');
  }
  await pauseAgent(scope, { reason: body.data.reason, source: 'operator', actor: actor(req), until });
  sendSuccess(res, await controlsOverview());
}

/** POST /admin/agents/:agent/resume: clears only the named row. */
export async function resumeAgentControl(req: Request, res: Response): Promise<void> {
  const scope = agentParam(req);
  const body = resumeAgentSchema.safeParse(req.body ?? {});
  if (!body.success) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid resume request', body.error.flatten().fieldErrors as any);
  }
  await resumeAgent(scope, { actor: actor(req), reason: body.data.reason });
  sendSuccess(res, await controlsOverview());
}

/**
 * GET /admin/trace-audit
 * Returns summary counts by status, the latest audit run details,
 * and paginated non-verified findings (with optional status filtering).
 */
export async function getTraceAuditSummary(req: Request, res: Response): Promise<void> {
  const { page, limit, skip } = parsePagination(req.query as any);
  const statusParam = req.query.status as string | undefined;

  let validStatus: TraceAuditStatus | undefined;
  if (statusParam) {
    if (Object.values(TraceAuditStatus).includes(statusParam as TraceAuditStatus)) {
      validStatus = statusParam as TraceAuditStatus;
    } else {
      sendError(res, 400, 'INVALID_STATUS', `Status must be one of: ${Object.values(TraceAuditStatus).join(', ')}`);
      return;
    }
  }

  const [countsGroup, latestRun, findings, totalFindings] = await Promise.all([
    prisma.traceAudit.groupBy({
      by: ['status'],
      _count: { status: true },
    }),
    prisma.traceAuditRun.findFirst({
      orderBy: { startedAt: 'desc' },
    }),
    prisma.traceAudit.findMany({
      where: validStatus
        ? { status: validStatus }
        : { status: { not: TraceAuditStatus.VERIFIED } },
      skip,
      take: limit,
      orderBy: { checkedAt: 'desc' },
    }),
    prisma.traceAudit.count({
      where: validStatus
        ? { status: validStatus }
        : { status: { not: TraceAuditStatus.VERIFIED } },
    }),
  ]);

  const counts: Record<string, number> = {};
  for (const status of Object.values(TraceAuditStatus)) {
    counts[status] = 0;
  }
  for (const g of countsGroup) {
    counts[g.status] = g._count.status;
  }

  sendSuccess(
    res,
    {
      counts,
      latestRun,
      findings,
    },
    200,
    buildPaginationMeta(page, limit, totalFindings) as any,
  );
}

/**
 * POST /admin/trace-audit/run
 * Starts a trace audit run asynchronously in the background.
 * Returns 202 with the runId.
 */
export async function triggerTraceAuditRun(req: Request, res: Response): Promise<void> {
  const runId = uuidv4();

  // Fire and forget
  runTraceAudit({ runId }).catch((err) => {
    logger.error({ err, runId }, 'Background trace audit run failed');
  });

  sendSuccess(res, { runId, message: 'Trace audit run scheduled' }, 202);
}

/**
 * GET /admin/chain/spec-compat (#34, #322)
 * Returns the enforcement mode, boot report, current report, and paginated
 * runtime check history (`spec_compat_runs`).
 */
export async function getSpecCompat(req: Request, res: Response): Promise<void> {
  const { page, limit, skip } = parsePagination(req.query as any);
  const { mode, report, boot, current, history, total } = await getSpecCompatHistory({ skip, take: limit });
  sendSuccess(res, { mode, report, boot, current, history }, 200, buildPaginationMeta(page, limit, total) as any);
}

/**
 * POST /admin/chain/spec-compat/ack (#322)
 * Acknowledges the current breaking spec drift report and clears `spec_drift`
 * holds once a compatibility check passes.
 */
export async function ackSpecCompat(req: Request, res: Response): Promise<void> {
  const result = await acknowledgeSpecDrift(actor(req));
  sendSuccess(res, result);
}

/**
 * GET /admin/status (#111)
 * Probe details, indexer lag, cron runs, chain mode and LLM state. Unlike
 * /readyz this includes ledger numbers, so it is admin-only.
 */
export async function getSystemStatus(_req: Request, res: Response): Promise<void> {
  const { ready, checks } = await health.readiness();
  const latestLedger = checks.find((c) => c.name === 'rpc')?.detail?.latestLedger;
  const indexer = indexerStatus();
  sendSuccess(res, {
    ready,
    draining: health.isDraining(),
    checks,
    indexer: {
      ...indexer,
      rpcLatestLedger: typeof latestLedger === 'number' ? latestLedger : null,
      lagLedgers: typeof latestLedger === 'number' && indexer.lastLedger !== null ? latestLedger - indexer.lastLedger : null,
    },
    crons: getCronStatus(),
    ipfsReplication: await getReplicationSummary().catch(() => null),
    chain: {
      mode: config.CHAIN_EXECUTION_MODE,
      agentPublicKey: agentSigner().publicKey ?? null,
      preflight: 'not_implemented',
      cache: getChainCache().stats(),
    },
    // Outbox backlog, handler streaks, signer/channel balances (#220). Public keys only.
    chainWrites: await chainWritesStatus().catch(() => null),
    // Cluster-wide Socket.io Redis Streams adapter lag & gaps (#293).
    socketStream: config.EVENT_BUS_ENABLED ? await socketStreamClusterStats().catch(() => null) : null,
    llm: {
      anthropicConfigured: secret('ANTHROPIC_API_KEY') !== '',
      geminiConfigured: secret('GEMINI_API_KEY') !== '',
      // Shared across instances (Redis); null when the guard store is down.
      usage: await getLlmUsage().catch(() => null),
    },
    bulkheads: getBulkheadStats(),
    process: {
      uptimeSeconds: process.uptime(),
      memory: process.memoryUsage(),
      version: process.env.npm_package_version ?? null,
    },
  });
}

/** GET /admin/reconciliation/runs?limit= — newest first. */
export async function listReconciliationRuns(req: Request, res: Response): Promise<void> {
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10) || 20));
  sendSuccess(res, await prisma.reconcileRun.findMany({ orderBy: { startedAt: 'desc' }, take: limit }));
}

/** GET /admin/reconciliation/runs/:id — the run and its findings, paginated. */
export async function getReconciliationRun(req: Request, res: Response): Promise<void> {
  const id = String(req.params.id);
  const run = await prisma.reconcileRun.findUnique({ where: { id } });
  if (!run) throw new AppError(404, 'RUN_NOT_FOUND', 'Reconciliation run not found');
  const { page, limit, skip } = parsePagination(req.query as any);
  const [findings, total] = await Promise.all([
    prisma.marketDriftReport.findMany({ where: { runId: id }, orderBy: { createdAt: 'asc' }, skip, take: limit }),
    prisma.marketDriftReport.count({ where: { runId: id } }),
  ]);
  sendSuccess(res, { run, findings }, 200, buildPaginationMeta(page, limit, total) as any);
}

/**
 * POST /admin/reconciliation/run
 * Starts a run in the background (same advisory lock as the cron) and returns
 * 202 with its id.
 */
export async function triggerReconciliationRun(req: Request, res: Response): Promise<void> {
  const parsed = reconcileRunSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid reconciliation request', parsed.error.flatten().fieldErrors as any);
  }
  const runId = uuidv4();
  const io = req.app.get('io') as { to(room: string): { emit(e: string, p: unknown): void } } | undefined;
  runReconciliation(
    { runId, dryRun: parsed.data.dryRun ?? false, ...(parsed.data.maxMarkets ? { maxMarkets: parsed.data.maxMarkets } : {}) },
    { ...defaultDeps, emit: io ? (e, p) => io.to('admins').emit(e, p) : undefined },
  ).catch((err) => logger.error({ err, runId }, 'Background reconciliation run failed'));
  sendSuccess(res, { runId, message: 'Reconciliation run scheduled' }, 202);
}

/** GET /admin/money-audit/runs?limit= — money-audit runs (#222), newest first. */
export async function listMoneyAuditRuns(req: Request, res: Response): Promise<void> {
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10) || 20));
  sendSuccess(res, await prisma.moneyAuditRun.findMany({ orderBy: { startedAt: 'desc' }, take: limit }));
}

/** GET /admin/money-audit/runs/:id/findings?severity=&invariant=&page=&limit= */
export async function listMoneyAuditFindings(req: Request, res: Response): Promise<void> {
  const id = String(req.params.id);
  const run = await prisma.moneyAuditRun.findUnique({ where: { id } });
  if (!run) throw new AppError(404, 'RUN_NOT_FOUND', 'Money audit run not found');
  const { page, limit, skip } = parsePagination(req.query as any);
  const where = {
    runId: id,
    ...(typeof req.query.severity === 'string' && req.query.severity ? { severity: req.query.severity.toUpperCase() } : {}),
    ...(typeof req.query.invariant === 'string' && req.query.invariant ? { invariant: req.query.invariant.toUpperCase() } : {}),
  };
  const [findings, total] = await Promise.all([
    prisma.moneyAuditFinding.findMany({ where, orderBy: { createdAt: 'asc' }, skip, take: limit }),
    prisma.moneyAuditFinding.count({ where }),
  ]);
  sendSuccess(res, { run, findings }, 200, buildPaginationMeta(page, limit, total) as any);
}

/**
 * POST /admin/money-audit/run
 * Starts an audit in the background (same advisory lock as the cron) and
 * returns 202 with its id. A dry run reports but never repairs.
 */
export async function triggerMoneyAuditRun(req: Request, res: Response): Promise<void> {
  const parsed = moneyAuditRunSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid money audit request', parsed.error.flatten().fieldErrors as any);
  }
  const runId = uuidv4();
  runMoneyAudit({ runId, dryRun: parsed.data.dryRun ?? false })
    .catch((err) => logger.error({ err, runId }, 'Background money audit run failed'));
  sendSuccess(res, { runId, message: 'Money audit run scheduled' }, 202);
}

/** POST /admin/money-audit/findings/:id/ack — later runs carry the ack by fingerprint and do not re-alert. */
export async function ackMoneyAuditFinding(req: Request, res: Response): Promise<void> {
  const id = String(req.params.id);
  const finding = await prisma.moneyAuditFinding.findUnique({ where: { id } });
  if (!finding) throw new AppError(404, 'FINDING_NOT_FOUND', 'Money audit finding not found');
  if (finding.ackedAt) {
    sendSuccess(res, finding);
    return;
  }
  sendSuccess(res, await prisma.moneyAuditFinding.update({
    where: { id },
    data: { action: 'ACKED', ackedBy: actor(req), ackedAt: new Date() },
  }));
}

/**
 * GET /admin/fees
 * Returns actual charged vs estimated fee statistics per operation class and day,
 * per-payer breakdown (agent, channels, fee payer), and the fee oracle snapshot (#39, #308).
 * Legacy `source = 'ESTIMATE'` rows are excluded from charged totals and counted separately.
 */
export async function getChainFeesReport(_req: Request, res: Response): Promise<void> {
  const oracle = getFeeOracle();
  const snapshot = oracle.getSnapshot();

  const [rows, payerRows, estimateRows] = await Promise.all([
    prisma.$queryRaw<Array<{
      op_class: string;
      day: Date;
      count: number | bigint;
      estimated_total: string | bigint;
      total_charged: string | bigint;
      refunded_total: string | bigint;
      rent_total: string | bigint;
      p50_charged: string | number;
      p95_charged: string | number;
      failed_count: number | bigint;
      failed_charged: string | bigint;
      known_resource_charged: string | bigint;
      known_resource_estimated: string | bigint;
    }>>`
      SELECT
        op_class,
        DATE_TRUNC('day', created_at) AS day,
        COUNT(*)::int AS count,
        COALESCE(SUM(total_fee), 0)::text AS estimated_total,
        COALESCE(SUM(fee_charged), 0)::text AS total_charged,
        COALESCE(SUM(
          CASE
            WHEN non_refundable_charged IS NOT NULL AND refundable_charged IS NOT NULL
            THEN resource_fee - (non_refundable_charged + refundable_charged)
            ELSE 0
          END
        ), 0)::text AS refunded_total,
        COALESCE(SUM(COALESCE(rent_charged, 0)), 0)::text AS rent_total,
        COALESCE(percentile_cont(0.50) WITHIN GROUP (ORDER BY fee_charged), 0)::numeric::text AS p50_charged,
        COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY fee_charged), 0)::numeric::text AS p95_charged,
        COUNT(*) FILTER (WHERE success = false)::int AS failed_count,
        COALESCE(SUM(fee_charged) FILTER (WHERE success = false), 0)::text AS failed_charged,
        COALESCE(SUM(
          CASE
            WHEN non_refundable_charged IS NOT NULL AND refundable_charged IS NOT NULL
            THEN non_refundable_charged + refundable_charged
            ELSE 0
          END
        ), 0)::text AS known_resource_charged,
        COALESCE(SUM(
          CASE
            WHEN non_refundable_charged IS NOT NULL AND refundable_charged IS NOT NULL
            THEN resource_fee
            ELSE 0
          END
        ), 0)::text AS known_resource_estimated
      FROM chain_fees
      WHERE source = 'RECEIPT' AND fee_charged IS NOT NULL
      GROUP BY op_class, DATE_TRUNC('day', created_at)
      ORDER BY day DESC, op_class ASC
    `,
    prisma.$queryRaw<Array<{
      payer: string | null;
      count: number | bigint;
      fee_bumped_count: number | bigint;
      estimated_total: string | bigint;
      charged_total: string | bigint;
      refunded_total: string | bigint;
      rent_total: string | bigint;
      failed_count: number | bigint;
      failed_charged: string | bigint;
    }>>`
      SELECT
        payer,
        COUNT(*)::int AS count,
        COUNT(*) FILTER (WHERE fee_bumped = true)::int AS fee_bumped_count,
        COALESCE(SUM(total_fee), 0)::text AS estimated_total,
        COALESCE(SUM(fee_charged), 0)::text AS charged_total,
        COALESCE(SUM(
          CASE
            WHEN non_refundable_charged IS NOT NULL AND refundable_charged IS NOT NULL
            THEN resource_fee - (non_refundable_charged + refundable_charged)
            ELSE 0
          END
        ), 0)::text AS refunded_total,
        COALESCE(SUM(COALESCE(rent_charged, 0)), 0)::text AS rent_total,
        COUNT(*) FILTER (WHERE success = false)::int AS failed_count,
        COALESCE(SUM(fee_charged) FILTER (WHERE success = false), 0)::text AS failed_charged
      FROM chain_fees
      WHERE source = 'RECEIPT' AND fee_charged IS NOT NULL
      GROUP BY payer
      ORDER BY SUM(fee_charged) DESC
    `,
    prisma.$queryRaw<Array<{ count: number | bigint }>>`
      SELECT COUNT(*)::int AS count
      FROM chain_fees
      WHERE source = 'ESTIMATE'
    `,
  ]);

  let agentAddress: string | null = null;
  try {
    agentAddress = (agentSigner().publicKey as string | undefined) ?? null;
  } catch {
    agentAddress = null;
  }
  let feePayerAddress: string | null = null;
  if (config.FEE_PAYER_SECRET) {
    try {
      feePayerAddress = Keypair.fromSecret(config.FEE_PAYER_SECRET).publicKey();
    } catch {
      feePayerAddress = null;
    }
  }
  const channelAddresses = new Set<string>();
  try {
    for (const ch of getChannelPool().getChannels()) {
      channelAddresses.add(ch.publicKey);
    }
  } catch {
    // Channel pool unavailable
  }

  const classifyPayer = (addr: string | null): 'agent' | 'channel' | 'fee_payer' | 'unknown' => {
    if (!addr) return 'unknown';
    if (feePayerAddress && addr === feePayerAddress) return 'fee_payer';
    if (agentAddress && addr === agentAddress) return 'agent';
    if (channelAddresses.has(addr)) return 'channel';
    return 'unknown';
  };

  const report = rows.map((r) => {
    const knownCharged = BigInt(r.known_resource_charged.toString());
    const knownEstimated = BigInt(r.known_resource_estimated.toString());
    const chargedToSimulatedRatio =
      knownEstimated > 0n ? Number(knownCharged) / Number(knownEstimated) : null;
    const chargedStr = r.total_charged.toString();
    return {
      opClass: r.op_class,
      day: r.day,
      count: Number(r.count),
      estimatedTotal: r.estimated_total.toString(),
      chargedTotal: chargedStr,
      totalCharged: chargedStr,
      refundedTotal: r.refunded_total.toString(),
      rentTotal: r.rent_total.toString(),
      p50Charged: r.p50_charged.toString(),
      p95Charged: r.p95_charged.toString(),
      failedCount: Number(r.failed_count),
      failedCharged: r.failed_charged.toString(),
      chargedToSimulatedRatio,
    };
  });

  const byPayer = payerRows.map((p) => ({
    payer: p.payer,
    role: classifyPayer(p.payer),
    count: Number(p.count),
    feeBumpedCount: Number(p.fee_bumped_count),
    estimatedTotal: p.estimated_total.toString(),
    chargedTotal: p.charged_total.toString(),
    refundedTotal: p.refunded_total.toString(),
    rentTotal: p.rent_total.toString(),
    failedCount: Number(p.failed_count),
    failedCharged: p.failed_charged.toString(),
  }));

  const estimateRowCount = Number(estimateRows[0]?.count ?? 0);
  const spend = await Promise.all(['market_create', 'trade', 'trace_publish', 'maintenance'].map((opClass) => spendSnapshot(opClass as any)));
  const spendReport = spend.flat().map((row) => ({ ...row, reserved: row.reserved.toString(), budget: row.budget.toString(), remaining: row.remaining.toString() }));

  sendSuccess(res, {
    oracle: snapshot,
    report,
    byPayer,
    estimateRowCount,
    spend: spendReport,
  });
}


/** GET /admin/admins — current role assignments. */
export async function getAdmins(_req: Request, res: Response): Promise<void> {
  sendSuccess(res, await listAdmins());
}

/** GET /admin/roles — the fixed catalogue and its permissions. */
export async function getAdminRoles(_req: Request, res: Response): Promise<void> {
  sendSuccess(res, await listRoles());
}

/** POST /admin/admins/grant — grant or change a role (step-up protected). */
export async function postGrantAdmin(req: Request, res: Response): Promise<void> {
  const { walletAddress, roleName } = (req.body ?? {}) as {
    walletAddress?: unknown;
    roleName?: unknown;
  };
  if (!isAdminAddress(walletAddress)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'walletAddress must be a Stellar G… address');
  }
  if (!isAdminRole(roleName)) {
    throw new AppError(400, 'VALIDATION_ERROR', `roleName must be one of: ${ADMIN_ROLES.join(', ')}`);
  }
  await grantAdminRole({ walletAddress, roleName, actor: actor(req) });
  sendSuccess(res, { walletAddress, roleName });
}

/** POST /admin/admins/revoke — remove every role from an address (step-up). */
export async function postRevokeAdmin(req: Request, res: Response): Promise<void> {
  const { walletAddress } = (req.body ?? {}) as { walletAddress?: unknown };
  if (!isAdminAddress(walletAddress)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'walletAddress must be a Stellar G… address');
  }
  await revokeAdminRole({ walletAddress, actor: actor(req) });
  sendSuccess(res, { revoked: true });
}

/** GET /admin/audit — append-only admin action trail. */
export async function getAdminAudit(req: Request, res: Response): Promise<void> {
  const { page, limit, skip } = parsePagination(req.query as any);
  const { rows, total } = await listAdminAudit(limit, skip);
  sendSuccess(res, rows, 200, buildPaginationMeta(page, limit, total) as any);
}

// ─── Dispute monitor (#92) ───────────────────────────────────────────────

const disputeIdSchema = z.object({ id: z.string().uuid('id must be a dispute review UUID') });
const disputeListSchema = z.object({ status: z.enum(['open', 'all']).default('open') });

function disputeId(req: Request): string {
  const parsed = disputeIdSchema.safeParse(req.params);
  if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid dispute id', parsed.error.flatten().fieldErrors as any);
  return parsed.data.id;
}

/** GET /admin/disputes?status=open|all — reviews with the window left on the ledger clock. */
export async function getDisputes(req: Request, res: Response): Promise<void> {
  const parsed = disputeListSchema.safeParse(req.query);
  if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', 'status must be open or all', parsed.error.flatten().fieldErrors as any);
  const { page, limit } = parsePagination(req.query as any);
  const { items, total, ledgerTime } = await listDisputes({ status: parsed.data.status, page, limit });
  sendSuccess(res, items, 200, { ...(buildPaginationMeta(page, limit, total) as any), ledgerTime });
}

/** POST /admin/disputes/:id/ack */
export async function ackDispute(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await acknowledge(disputeId(req), actor(req)));
}

/** POST /admin/disputes/:id/cancel-tx — unsigned cancel_proposal for the guardian's wallet. */
export async function cancelDisputeTx(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await buildGuardianTx(disputeId(req), 'cancel_proposal'));
}

/** POST /admin/disputes/:id/void-tx — unsigned guardian_void_market. */
export async function voidDisputeTx(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await buildGuardianTx(disputeId(req), 'guardian_void_market'));
}

// ─── Admin outbox console (#221) ─────────────────────────────────────────

function outboxId(req: Request): string {
  const parsed = outboxIdSchema.safeParse(String(req.params.id ?? ''));
  if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', 'id must be a chain transaction UUID');
  return parsed.data;
}

function outboxReason(req: Request): string {
  const parsed = outboxActionSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    throw new AppError(400, 'VALIDATION_ERROR', 'reason is required (10-500 characters)', parsed.error.flatten().fieldErrors as any);
  }
  return parsed.data.reason;
}

/** GET /admin/chain/transactions — outbox rows, newest first, with filters. */
export async function listChainTransactions(req: Request, res: Response): Promise<void> {
  const parsed = outboxListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid outbox filter', parsed.error.flatten().fieldErrors as any);
  }
  const { page, limit } = parsePagination(req.query as any);
  const { rows, total } = await listOutbox({ ...parsed.data, page, limit });
  sendSuccess(res, rows, 200, buildPaginationMeta(page, limit, total) as any);
}

/** GET /admin/chain/transactions/:id — decoded envelope, fee bumps, RPC status, linked rows. */
export async function getChainTransaction(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await outboxDetail(outboxId(req)));
}

/** POST /admin/chain/transactions/:id/recover — one recovery pass for this row now. */
export async function recoverChainTransaction(req: Request, res: Response): Promise<void> {
  const id = outboxId(req);
  sendSuccess(res, await recoverNow(id, actor(req), outboxReason(req)));
}

/** POST /admin/chain/transactions/:id/rerun-handler — terminal rows only. */
export async function rerunChainTransactionHandler(req: Request, res: Response): Promise<void> {
  const id = outboxId(req);
  sendSuccess(res, await rerunHandler(id, actor(req), outboxReason(req)));
}

/** POST /admin/chain/transactions/:id/abandon — only when the envelope provably cannot land. */
export async function abandonChainTransaction(req: Request, res: Response): Promise<void> {
  const id = outboxId(req);
  sendSuccess(res, await abandon(id, actor(req), outboxReason(req)));
}

/** GET /admin/execution-quality — implementation shortfall, slippage failures & recommended bounds (#295). */
export async function getExecutionQuality(req: Request, res: Response): Promise<void> {
  const { getExecutionQualitySummary } = await import('../services/execution-quality.service');
  const rawDays = req.query.windowDays;
  const windowDays = typeof rawDays === 'string' && /^[1-9]\d*$/.test(rawDays)
    ? Math.min(365, Number(rawDays))
    : 30;
  sendSuccess(res, await getExecutionQualitySummary({ windowDays }));
}

/** GET /admin/indexer/gaps — list indexer ledger gaps (#10) */
export async function getIndexerGaps(req: Request, res: Response): Promise<void> {
  const { page, limit, skip } = parsePagination(req);
  const openParam = req.query.open;
  const where: any = { network: CURSOR_ID };
  if (openParam === 'true') {
    where.resolvedAt = null;
  } else if (openParam === 'false') {
    where.resolvedAt = { not: null };
  }

  const [gaps, total] = await Promise.all([
    prisma.indexerGap.findMany({
      where,
      orderBy: [{ detectedAt: 'desc' }, { fromLedger: 'desc' }],
      skip,
      take: limit,
    }),
    prisma.indexerGap.count({ where }),
  ]);

  sendSuccess(res, gaps, 200, buildPaginationMeta(page, limit, total));
}

const resolveGapSchema = z.object({
  resolvedBy: z.string().min(1, 'resolvedBy is required'),
  note: z.string().optional(),
});

/** PATCH /admin/indexer/gaps/:id/resolve — mark an indexer gap resolved (#10) */
export async function resolveIndexerGap(req: Request, res: Response): Promise<void> {
  const id = String(req.params.id);
  const parsed = resolveGapSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid resolve body', parsed.error.flatten().fieldErrors as any);
  }

  const existing = await prisma.indexerGap.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, 'NOT_FOUND', `Indexer gap ${id} not found`);
  }
  if (existing.resolvedAt !== null) {
    throw new AppError(409, 'ALREADY_RESOLVED', `Indexer gap ${id} is already resolved`);
  }

  const updated = await prisma.indexerGap.update({
    where: { id },
    data: {
      resolvedAt: new Date(),
      resolvedBy: parsed.data.resolvedBy,
      note: parsed.data.note ?? existing.note,
    },
  });

  sendSuccess(res, updated, 200);
}

export async function getAgentDecisions(req: Request, res: Response): Promise<void> {
  sendSuccess(res, []);
}

export async function getAgentDecisionCycles(req: Request, res: Response): Promise<void> {
  sendSuccess(res, []);
}

export async function getAgentDecisionCycleFunnel(req: Request, res: Response): Promise<void> {
  sendSuccess(res, {});
}

export async function getCronRuns(req: Request, res: Response): Promise<void> {
  sendSuccess(res, []);
}

function weightSetId(req: Request): string {
  const id = String(req.params.id ?? '').trim();
  if (!id || id.length > 64) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid weight set id');
  return id;
}

export async function listSourceWeightSets(_req: Request, res: Response): Promise<void> {
  sendSuccess(res, await sourceWeights.listWeightSets());
}

export async function getSourceWeightSet(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await sourceWeights.getWeightSetWithDiff(weightSetId(req)));
}

export async function approveSourceWeightSet(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await sourceWeights.approveWeightSet(weightSetId(req), actor(req)));
}

export async function activateSourceWeightSet(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await sourceWeights.activateWeightSet(weightSetId(req), actor(req)));
}

export async function rollbackSourceWeightSet(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await sourceWeights.rollbackWeightSet(actor(req)));
}
