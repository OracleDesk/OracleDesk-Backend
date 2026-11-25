/**
 * Schemas and defaults for versioned agent risk parameters (#274).
 */
import { z } from 'zod';
import { config } from '../config';
import { SOURCE_WEIGHTS } from '../services/market-policy';
import { canonicalJson, sha256Hex } from '../utils/hash.util';

export const RISK_PARAM_SCOPES = ['TRADER', 'MARKET_MAKER'] as const;
export type RiskParamScope = (typeof RISK_PARAM_SCOPES)[number];

export const SEED_CATEGORIES = [
  'FED', 'ECB', 'MACRO', 'ELECTION', 'GEOPOLITICAL', 'CRYPTO', 'POLITICS', 'SPORTS', 'ENTERTAINMENT',
] as const;

const zRaw = z.string().regex(/^\d+$/, 'must be a decimal integer string');

export const TraderParamsV1 = z
  .object({
    schemaVersion: z.literal(1),
    minEdge: z.number().min(0.01).max(0.5),
    minConservativeEdge: z.number().min(0).max(0.5),
    kellyMultiplier: z.number().min(0.05).max(1),
    maxSinglePositionPct: z.number().min(0.001).max(0.05),
    minLiquidity: z.number().min(0),
    horizonDays: z.number().int().min(1).max(90),
    headroomSafetyBps: z.number().int().min(0).max(5000),
    budgetMaxAgeMs: z.number().int().min(5_000).max(600_000),
    stopLossBps: z.number().int().min(100).max(9000),
    hedgeLossBps: z.number().int().min(100).max(9000),
    maxDailyDrawdownPct: z.number().min(0.001).max(0.2),
    drawdownPauseHours: z.number().min(0.25).max(48),
    maxCorrelatedExposurePct: z.number().min(0).max(0.25),
    correlationThreshold: z.number().min(0).max(1),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p.minConservativeEdge > p.minEdge) {
      ctx.addIssue({ code: 'custom', path: ['minConservativeEdge'], message: 'must be <= minEdge' });
    }
  });

export type TraderParamsV1 = z.infer<typeof TraderParamsV1>;

const categoryRecord = z.record(
  z.enum(SEED_CATEGORIES),
  z.number().min(0),
);

export const MarketMakerParamsV1 = z
  .object({
    schemaVersion: z.literal(1),
    lpLossBudgetRaw: zRaw,
    mmDailyShareBps: z.number().int().min(0).max(10_000),
    maxSeedFractionBps: z.number().int().min(0).max(10_000),
    maxUnresolvedSeededRaw: zRaw,
    categoryBaseUsdc: categoryRecord,
    ciWidthForFullShrink: z.number().min(0.01).max(2),
    shrinkMax: z.number().min(0).max(1),
    sourceWeights: z.record(z.string(), z.number().min(0).max(1)),
  })
  .strict();

export type MarketMakerParamsV1 = z.infer<typeof MarketMakerParamsV1>;

export function traderParamsHash(params: TraderParamsV1): string {
  return sha256Hex(canonicalJson(params));
}

export function marketMakerParamsHash(params: MarketMakerParamsV1): string {
  return sha256Hex(canonicalJson(params));
}

export function parseTraderParams(input: unknown): TraderParamsV1 {
  return TraderParamsV1.parse(input);
}

export function parseMarketMakerParams(input: unknown): MarketMakerParamsV1 {
  return MarketMakerParamsV1.parse(input);
}

/** Values that match the pre-#274 constants and env defaults. */
export function compiledTraderParamsV1(): TraderParamsV1 {
  return {
    schemaVersion: 1,
    minEdge: 0.08,
    minConservativeEdge: 0.08,
    kellyMultiplier: 0.5,
    maxSinglePositionPct: 0.025,
    minLiquidity: 500,
    horizonDays: 14,
    headroomSafetyBps: config.TREASURY_HEADROOM_SAFETY_BPS,
    budgetMaxAgeMs: 60_000,
    stopLossBps: 1500,
    hedgeLossBps: 1000,
    maxDailyDrawdownPct: 0.03,
    drawdownPauseHours: 4,
    maxCorrelatedExposurePct: 0.05,
    correlationThreshold: 0.6,
  };
}

export function compiledMarketMakerParamsV1(): MarketMakerParamsV1 {
  return {
    schemaVersion: 1,
    lpLossBudgetRaw: config.LP_LOSS_BUDGET_RAW.toString(),
    mmDailyShareBps: config.MM_DAILY_SHARE_BPS,
    maxSeedFractionBps: config.MAX_SEED_FRACTION_BPS,
    maxUnresolvedSeededRaw: config.MAX_UNRESOLVED_SEEDED_RAW.toString(),
    categoryBaseUsdc: config.SEED_CATEGORY_BASE_USDC as Record<(typeof SEED_CATEGORIES)[number], number>,
    ciWidthForFullShrink: 0.6,
    shrinkMax: 0.5,
    sourceWeights: { ...SOURCE_WEIGHTS },
  };
}

export function schemaForScope(scope: RiskParamScope) {
  return scope === 'TRADER' ? TraderParamsV1 : MarketMakerParamsV1;
}

export function hashParams(scope: RiskParamScope, params: unknown): string {
  if (scope === 'TRADER') return traderParamsHash(parseTraderParams(params));
  return marketMakerParamsHash(parseMarketMakerParams(params));
}

export interface ParamSnapshot<T> {
  scope: RiskParamScope;
  version: number;
  hash: string;
  setId: string;
  params: T;
}

export function riskProvenance(snapshot: ParamSnapshot<unknown>): { scope: string; version: number; hash: string } {
  return { scope: snapshot.scope, version: snapshot.version, hash: snapshot.hash };
}