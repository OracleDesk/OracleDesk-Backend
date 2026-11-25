/**
 * Versioned trader and market-maker risk parameters (#274).
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { AppError } from '../middlewares/error.middleware';
import { withAdvisoryLock } from '../lib/advisory-lock';
import {
  RISK_PARAM_SCOPES,
  RiskParamScope,
  compiledMarketMakerParamsV1,
  compiledTraderParamsV1,
  hashParams,
  type MarketMakerParamsV1,
  type ParamSnapshot,
  schemaForScope,
  type TraderParamsV1,
} from '../lib/risk-params';
type RiskParamsEmitter = (event: 'RISK_PARAMS_CHANGED', payload: Record<string, unknown>) => void;
let riskEmitter: RiskParamsEmitter | null = null;

export function setRiskParamsEmitter(fn: RiskParamsEmitter | null): void {
  riskEmitter = fn;
}

export { RISK_PARAM_SCOPES, type RiskParamScope, type ParamSnapshot, type TraderParamsV1, type MarketMakerParamsV1 };

const LOCK = 'risk-param:activate';

function failClosed(scope: RiskParamScope, detail: string): never {
  logger.error({ scope, detail }, 'RISK_PARAMS_INVALID');
  throw new AppError(503, 'RISK_PARAMS_INVALID', 'Active risk parameters failed validation; cycle aborted');
}

async function rowToSnapshot<T>(scope: RiskParamScope, row: { id: string; version: number; paramsHash: string; params: unknown }): Promise<ParamSnapshot<T>> {
  const schema = schemaForScope(scope);
  const parsed = schema.parse(row.params) as T;
  const hash = hashParams(scope, parsed);
  if (hash !== row.paramsHash) failClosed(scope, 'hash mismatch');
  return { scope, version: row.version, hash, setId: row.id, params: parsed };
}

export async function snapshotActive<T = TraderParamsV1 | MarketMakerParamsV1>(scope: RiskParamScope): Promise<ParamSnapshot<T>> {
  const active = await prisma.riskParamActive.findUnique({ where: { scope } });
  if (!active) failClosed(scope, 'no active row');
  const set = await prisma.riskParamSet.findUnique({ where: { id: active.setId } });
  if (!set || set.status !== 'ACTIVE') failClosed(scope, 'active pointer stale');
  return rowToSnapshot<T>(scope, set);
}

export async function snapshotTrader(): Promise<ParamSnapshot<TraderParamsV1>> {
  return snapshotActive<TraderParamsV1>('TRADER');
}

export async function snapshotMarketMaker(): Promise<ParamSnapshot<MarketMakerParamsV1>> {
  return snapshotActive<MarketMakerParamsV1>('MARKET_MAKER');
}

export async function listRiskParamSets(scope: RiskParamScope): Promise<unknown[]> {
  return prisma.riskParamSet.findMany({
    where: { scope },
    orderBy: { version: 'desc' },
  });
}

export async function getRiskParamSet(id: string): Promise<{
  set: unknown;
  active: { version: number; setId: string } | null;
  diff: Record<string, { active: unknown; proposed: unknown }> | null;
}> {
  const set = await prisma.riskParamSet.findUnique({ where: { id } });
  if (!set) throw new AppError(404, 'RISK_PARAM_SET_NOT_FOUND', 'Risk parameter set not found');
  const scope = set.scope as RiskParamScope;
  const activeRow = await prisma.riskParamSet.findFirst({ where: { scope, status: 'ACTIVE' } });
  const active =
    activeRow == null ? null : { version: activeRow.version, setId: activeRow.id };
  let diff: Record<string, { active: unknown; proposed: unknown }> | null = null;
  if (activeRow && typeof set.params === 'object' && set.params && typeof activeRow.params === 'object' && activeRow.params) {
    diff = {};
    const keys = new Set([
      ...Object.keys(activeRow.params as object),
      ...Object.keys(set.params as object),
    ]);
    for (const k of keys) {
      const a = (activeRow.params as Record<string, unknown>)[k];
      const p = (set.params as Record<string, unknown>)[k];
      if (JSON.stringify(a) !== JSON.stringify(p)) diff[k] = { active: a, proposed: p };
    }
    if (Object.keys(diff).length === 0) diff = null;
  }
  return { set, active, diff };
}

export async function proposeRiskParamSet(params: {
  scope: RiskParamScope;
  params: unknown;
  reason: string;
  actor: string;
}): Promise<{ id: string; version: number; paramsHash: string }> {
  const { scope, reason, actor } = params;
  if (!RISK_PARAM_SCOPES.includes(scope)) {
    throw new AppError(400, 'VALIDATION_ERROR', `scope must be one of: ${RISK_PARAM_SCOPES.join(', ')}`);
  }
  const schema = schemaForScope(scope);
  const parsed = schema.parse(params.params);
  const paramsHash = hashParams(scope, parsed);
  const canonical = JSON.parse(JSON.stringify(parsed));

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${LOCK}))`;
    const max = await tx.riskParamSet.aggregate({ where: { scope }, _max: { version: true } });
    const version = (max._max.version ?? 0) + 1;
    const row = await tx.riskParamSet.create({
      data: {
        scope,
        version,
        params: canonical as Prisma.InputJsonValue,
        paramsHash,
        status: 'PROPOSED',
        reason,
        proposedBy: actor,
      },
    });
    await tx.adminAuditLog.create({
      data: {
        actor,
        action: 'RISK_PARAMS_PROPOSED',
        target: row.id,
        metadata: { scope, version, paramsHash },
      },
    });
    return { id: row.id, version, paramsHash };
  });
}

export async function approveRiskParamSet(id: string, actor: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const set = await tx.riskParamSet.findUnique({ where: { id } });
    if (!set) throw new AppError(404, 'RISK_PARAM_SET_NOT_FOUND', 'Risk parameter set not found');
    if (set.status !== 'PROPOSED') throw new AppError(409, 'RISK_PARAM_SET_NOT_PROPOSED', `Set is ${set.status}`);
    if (set.proposedBy === actor) {
      throw new AppError(403, 'SELF_APPROVAL', 'Risk parameters must be approved by a different admin than the proposer');
    }
    hashParams(set.scope as RiskParamScope, set.params);
    await tx.riskParamSet.update({
      where: { id },
      data: { status: 'APPROVED', approvedBy: actor, approvedAt: new Date() },
    });
    await tx.adminAuditLog.create({
      data: { actor, action: 'RISK_PARAMS_APPROVED', target: id, metadata: { scope: set.scope, version: set.version } },
    });
  });
}

export async function rejectRiskParamSet(id: string, actor: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const set = await tx.riskParamSet.findUnique({ where: { id } });
    if (!set) throw new AppError(404, 'RISK_PARAM_SET_NOT_FOUND', 'Risk parameter set not found');
    if (set.status !== 'PROPOSED') throw new AppError(409, 'RISK_PARAM_SET_NOT_PROPOSED', `Set is ${set.status}`);
    await tx.riskParamSet.update({ where: { id }, data: { status: 'REJECTED', approvedBy: actor, approvedAt: new Date() } });
    await tx.adminAuditLog.create({
      data: { actor, action: 'RISK_PARAMS_REJECTED', target: id, metadata: { scope: set.scope, version: set.version } },
    });
  });
}

export async function activateRiskParamSet(id: string, actor: string): Promise<void> {
  const activated = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${LOCK}))`;
    const set = await tx.riskParamSet.findUnique({ where: { id } });
    if (!set) throw new AppError(404, 'RISK_PARAM_SET_NOT_FOUND', 'Risk parameter set not found');
    if (set.status !== 'APPROVED' && set.status !== 'RETIRED') {
      throw new AppError(409, 'RISK_PARAM_SET_NOT_ACTIVATABLE', `Only APPROVED or RETIRED sets can be activated (this one is ${set.status})`);
    }
    const scope = set.scope as RiskParamScope;
    hashParams(scope, set.params);
  const previous = await tx.riskParamSet.findFirst({ where: { scope, status: 'ACTIVE' } });
    if (previous) {
      await tx.riskParamSet.update({ where: { id: previous.id }, data: { status: 'RETIRED' } });
    }
    const now = new Date();
    const updated = await tx.riskParamSet.update({
      where: { id },
      data: { status: 'ACTIVE', activatedBy: actor, activatedAt: now },
    });
    await tx.riskParamActive.upsert({
      where: { scope },
      create: { scope, setId: id, version: set.version, activatedAt: now },
      update: { setId: id, version: set.version, activatedAt: now },
    });
    await tx.adminAuditLog.create({
      data: {
        actor,
        action: 'RISK_PARAMS_ACTIVATED',
        target: id,
        metadata: { scope, version: set.version, previousId: previous?.id ?? null },
      },
    });
    return { scope, version: updated.version };
  });
  riskEmitter?.('RISK_PARAMS_CHANGED', activated);
}

/** First boot: one ACTIVE version per scope from compiled defaults (#274). */
export async function bootstrapRiskParams(): Promise<void> {
  if ((await prisma.riskParamActive.count()) > 0) return;
  const result = await withAdvisoryLock('risk-param:bootstrap', async (tx) => {
    if ((await tx.riskParamActive.count()) > 0) return;
    for (const scope of RISK_PARAM_SCOPES) {
      const params =
        scope === 'TRADER'
          ? compiledTraderParamsV1()
          : compiledMarketMakerParamsV1();
      const paramsHash = hashParams(scope, params);
      const row = await tx.riskParamSet.create({
        data: {
          scope,
          version: 1,
          params: params as unknown as Prisma.InputJsonValue,
          paramsHash,
          status: 'ACTIVE',
          reason: 'bootstrap',
          proposedBy: 'bootstrap',
          approvedBy: 'bootstrap',
          activatedBy: 'bootstrap',
          approvedAt: new Date(),
          activatedAt: new Date(),
        },
      });
      await tx.riskParamActive.create({
        data: { scope, setId: row.id, version: 1, activatedAt: new Date() },
      });
    }
    logger.info('Bootstrapped risk parameter sets v1');
  });
  if (!result.acquired) {
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 100));
      if ((await prisma.riskParamActive.count()) > 0) return;
    }
    throw new Error('Risk param bootstrap did not complete');
  }
}

export function traderParamsFromSnapshot(snapshot: ParamSnapshot<TraderParamsV1>) {
  const p = snapshot.params;
  return {
    ...p,
    paramsVersion: { version: snapshot.version, hash: snapshot.hash },
  };
}

export type TraderPolicyParams = ReturnType<typeof traderParamsFromSnapshot>;