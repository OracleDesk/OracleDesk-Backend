import { z } from 'zod';

export const TraceDocV1 = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal('oracledesk.trace'),
    traceId: z.string().uuid(),
    agentType: z.enum(['MARKET_MAKER', 'TRADER']),
    decisionType: z.string().min(1).max(64),
    action: z.string().min(1).max(64),
    market: z
      .object({
        backendId: z.string().uuid(),
        onChainId: z.string().regex(/^\d+$/).nullable(),
      })
      .strict(),
    probabilityEstimate: z.number().min(0).max(1),
    marketProbability: z.number().min(0).max(1),
    edge: z.number().min(-1).max(1),
    confidenceInterval: z
      .object({
        lower: z.number(),
        upper: z.number(),
      })
      .strict()
      .refine((ci) => ci.lower <= ci.upper, {
        message: 'lower must be <= upper',
      }),
    sourcesUsed: z
      .array(
        z
          .object({
            source: z.string(),
            weight: z.number().min(0).max(1),
            signal: z.string(),
            rawValue: z.number().nullable(),
          })
          .strict(),
      )
      .max(50),
    betFraction: z.number().nullable(),
    betSizeUsdc: z.number().nullable(),
    hedgeConditions: z.array(z.string().max(500)).max(20),
    agentWallet: z.string().nullable(),
    createdAt: z.string().datetime(),
  })
  .strict();

export type TraceDocV1 = z.infer<typeof TraceDocV1>;

export const LegacyTraceDoc = z.record(z.string(), z.unknown());
export type LegacyTraceDoc = z.infer<typeof LegacyTraceDoc>;

export const TraceDocAny = z.union([TraceDocV1, LegacyTraceDoc]);
export type TraceDocAny = z.infer<typeof TraceDocAny>;

export interface ContractsReasoningTrace {
  agent: 'market-maker' | 'trader';
  marketId: number | string | null;
  action: string;
  reasoning: string;
  inputs?: Array<{ source: string; weight: number; signal: string; rawValue?: number | null }>;
  timestamp: number; // unix seconds
  traceId?: string;
  probabilityEstimate?: number;
  marketProbability?: number;
  edge?: number;
  confidenceInterval?: { lower: number; upper: number };
}

/**
 * Maps a contracts-repo style trace into backend TraceDocV1.
 */
export function fromContractsTrace(
  t: ContractsReasoningTrace,
  fallbackMarketUuid = '00000000-0000-0000-0000-000000000000',
  fallbackTraceUuid = '00000000-0000-0000-0000-000000000001',
): TraceDocV1 {
  const agentType = t.agent === 'trader' ? 'TRADER' : 'MARKET_MAKER';
  const createdAt = new Date(t.timestamp * 1000).toISOString();
  const onChainId =
    t.marketId !== null && t.marketId !== undefined ? String(t.marketId) : null;

  const sourcesUsed = (t.inputs ?? []).slice(0, 50).map((inp) => ({
    source: inp.source,
    weight: Math.max(0, Math.min(1, inp.weight)),
    signal: inp.signal,
    rawValue: inp.rawValue ?? null,
  }));

  const probEst = t.probabilityEstimate ?? 0.5;
  const mktProb = t.marketProbability ?? 0.5;
  const edge = t.edge ?? probEst - mktProb;
  const ci = t.confidenceInterval ?? { lower: 0.4, upper: 0.6 };

  return TraceDocV1.parse({
    schemaVersion: 1,
    kind: 'oracledesk.trace',
    traceId: t.traceId ?? fallbackTraceUuid,
    agentType,
    decisionType: t.action.toUpperCase(),
    action: t.action,
    market: {
      backendId: fallbackMarketUuid,
      onChainId,
    },
    probabilityEstimate: probEst,
    marketProbability: mktProb,
    edge,
    confidenceInterval: {
      lower: Math.min(ci.lower, ci.upper),
      upper: Math.max(ci.lower, ci.upper),
    },
    sourcesUsed,
    betFraction: null,
    betSizeUsdc: null,
    hedgeConditions: [],
    agentWallet: null,
    createdAt,
  });
}

/**
 * Builds a validated TraceDocV1 with explicit nulls for optional fields.
 */
export function buildTraceDoc(params: {
  traceId: string;
  agentType: 'MARKET_MAKER' | 'TRADER';
  decisionType: string;
  action: string;
  backendMarketId: string;
  onChainMarketId: string | bigint | number | null;
  probabilityEstimate: number;
  marketProbability: number;
  edge: number;
  confidenceInterval: { lower: number; upper: number };
  sourcesUsed: Array<{ source: string; weight: number; signal: string; rawValue?: number | null }>;
  betFraction?: number | null;
  betSizeUsdc?: number | null;
  hedgeConditions?: string[] | null;
  agentWallet?: string | null;
  createdAt?: string | Date;
}): TraceDocV1 {
  const onChainId =
    params.onChainMarketId !== null && params.onChainMarketId !== undefined
      ? String(params.onChainMarketId)
      : null;

  const createdAt = params.createdAt
    ? typeof params.createdAt === 'string'
      ? params.createdAt
      : params.createdAt.toISOString()
    : new Date().toISOString();

  const sourcesUsed = (params.sourcesUsed ?? []).slice(0, 50).map((s) => ({
    source: s.source,
    weight: Math.max(0, Math.min(1, s.weight)),
    signal: s.signal,
    rawValue: s.rawValue ?? null,
  }));

  const ci = {
    lower: Math.min(params.confidenceInterval.lower, params.confidenceInterval.upper),
    upper: Math.max(params.confidenceInterval.lower, params.confidenceInterval.upper),
  };

  const doc = {
    schemaVersion: 1 as const,
    kind: 'oracledesk.trace' as const,
    traceId: params.traceId,
    agentType: params.agentType,
    decisionType: params.decisionType,
    action: params.action,
    market: {
      backendId: params.backendMarketId,
      onChainId,
    },
    probabilityEstimate: Math.max(0, Math.min(1, params.probabilityEstimate)),
    marketProbability: Math.max(0, Math.min(1, params.marketProbability)),
    edge: Math.max(-1, Math.min(1, params.edge)),
    confidenceInterval: ci,
    sourcesUsed,
    betFraction: params.betFraction ?? null,
    betSizeUsdc: params.betSizeUsdc ?? null,
    hedgeConditions: (params.hedgeConditions ?? []).slice(0, 20).map((h) => h.slice(0, 500)),
    agentWallet: params.agentWallet ?? null,
    createdAt,
  };

  return TraceDocV1.parse(doc);
}
