import { z } from 'zod';
import {
  HedgePredicateSchema,
  MAX_HEDGE_PREDICATES,
  type HedgePredicate,
} from './hedge-predicate';

// z.guid(), not z.uuid(): zod 4's uuid() also checks RFC 9562 version and
// variant bits, which the published JSON Schema (`format: uuid`) and zod 3
// never did. guid() is the 8-4-4-4-12 hex shape both of them accept.
export const TraceDocV1 = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal('oracledesk.trace'),
    traceId: z.guid(),
    agentType: z.enum(['MARKET_MAKER', 'TRADER']),
    decisionType: z.string().min(1).max(64),
    action: z.string().min(1).max(64),
    market: z
      .object({
        backendId: z.guid(),
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
    citedSourceIds: z.array(z.string()).max(50).optional(),
    betFraction: z.number().nullable(),
    betSizeUsdc: z.number().nullable(),
    hedgeConditions: z.array(z.string().max(500)).max(20),
    agentWallet: z.string().nullable(),
    createdAt: z.string().datetime(),
  })
  .strict();

export type TraceDocV1 = z.infer<typeof TraceDocV1>;

/**
 * One piece of evidence (#73). Every key is present: fields a signal does not
 * carry are null, so all code paths pin the same key set.
 */
export const TraceEvidence = z
  .object({
    source: z.string(),
    weight: z.number().min(0).max(1),
    signal: z.string(),
    rawValue: z.number().nullable(),
    signalId: z.string().nullable(),
    url: z.string().url().nullable(),
    publisher: z.string().nullable(),
    publishedAt: z.string().datetime().nullable(),
  })
  .strict();
export type TraceEvidence = z.infer<typeof TraceEvidence>;

const LlmProvider = z.enum(['anthropic', 'gemini']);

/** Mirrors ProvenanceEntry in src/lib/llm/provenance.ts. */
const ProvenanceEntrySchema = z.discriminatedUnion('source', [
  z
    .object({
      source: z.literal('llm'),
      provider: LlmProvider,
      model: z.string(),
      promptId: z.string(),
      promptVersion: z.number().int(),
      promptHash: z.string(),
      params: z.object({ temperature: z.number(), maxTokens: z.number().int() }).strict(),
      usage: z.object({ inputTokens: z.number().int(), outputTokens: z.number().int() }).strict().nullable(),
      latencyMs: z.number(),
      attempts: z.number().int(),
      // buildTraceProvenance omits these rather than nulling them.
      fallbackFrom: z
        .object({ provider: LlmProvider, model: z.string(), errorClass: z.string() })
        .strict()
        .optional(),
      outputSha256: z.string(),
    })
    .strict(),
  z
    .object({
      source: z.literal('default'),
      promptId: z.string(),
      promptVersion: z.number().int(),
      reason: z.enum(['LLM_FAILED', 'LLM_BUDGET_EXCEEDED']),
    })
    .strict(),
]);

/** Mirrors TraceProvenance in src/lib/llm/provenance.ts (#66). */
export const TraceProvenanceSchema = z
  .object({
    schema: z.literal('oracledesk.trace.provenance/1'),
    llm: z.array(ProvenanceEntrySchema).min(1),
    generator: z
      .object({
        service: z.literal('oracledesk-backend'),
        version: z.string(),
        commit: z.string().optional(),
      })
      .strict(),
  })
  .strict();

/**
 * Trace document v2 (#227): v1 plus everything the agents compute for a
 * decision. v1 is published with additionalProperties: false, so these
 * fields bump the version instead of mutating v1.
 */
export const TraceDocV2 = TraceDocV1.extend({
  schemaVersion: z.literal(2),
  sourcesUsed: z.array(TraceEvidence).max(50),
  provenance: TraceProvenanceSchema,
  forecast: z.record(z.string(), z.unknown()).nullable(),
  sizing: z.record(z.string(), z.unknown()).nullable(),
  seedPolicy: z.record(z.string(), z.unknown()).nullable(),
  correlation: z
    .object({
      pairs: z.array(z.unknown()),
      method: z.enum(['snapshot', 'matrix']),
      snapshotId: z.string().nullable(),
    })
    .strict()
    .nullable(),
  /** Cross-source corroboration verdict (#228). Market-creation traces only. */
  corroboration: z
    .object({
      kind: z.enum(['CORROBORATED', 'AUTHORITATIVE', 'UNCORROBORATED']),
      units: z.number().int().min(0),
      domains: z.array(z.string()).max(50),
    })
    .strict()
    .nullable(),
  /** Machine-checkable hedge predicates (#302). Null on older traces. */
  hedgePredicates: z.array(HedgePredicateSchema).max(MAX_HEDGE_PREDICATES).nullable().optional(),
}).strict();
export type TraceDocV2 = z.infer<typeof TraceDocV2>;

export const LegacyTraceDoc = z.record(z.string(), z.unknown());
export type LegacyTraceDoc = z.infer<typeof LegacyTraceDoc>;

/** Order matters: the record schema accepts everything, so it goes last. */
export const TraceDocAny = z.union([TraceDocV2, TraceDocV1, LegacyTraceDoc]);
export type TraceDocAny = z.infer<typeof TraceDocAny>;

/** Which version a stored payload is. `legacy` covers schemaVersion 0 / absent. */
export function classifyTraceDoc(payload: unknown): 'v2' | 'v1' | 'legacy' | 'invalid' {
  if (TraceDocV2.safeParse(payload).success) return 'v2';
  if (TraceDocV1.safeParse(payload).success) return 'v1';
  if (LegacyTraceDoc.safeParse(payload).success) return 'legacy';
  return 'invalid';
}

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
  citedSourceIds?: string[];
  betFraction?: number | null;
  betSizeUsdc?: number | null;
  hedgeConditions?: string[] | null;
  hedgePredicates?: HedgePredicate[] | null;
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
    ...(params.citedSourceIds !== undefined ? { citedSourceIds: params.citedSourceIds.slice(0, 50) } : {}),
    betFraction: params.betFraction ?? null,
    betSizeUsdc: params.betSizeUsdc ?? null,
    hedgeConditions: (params.hedgeConditions ?? []).slice(0, 20).map((h) => h.slice(0, 500)),
    agentWallet: params.agentWallet ?? null,
    createdAt,
  };

  return TraceDocV1.parse(doc);
}

/**
 * Normalises a loosely typed record (forecast, sizing, seed policy,
 * correlation pairs) to plain JSON: Date → ISO string, bigint → decimal
 * string, non-finite numbers → null, undefined object keys dropped and
 * undefined array items → null. Anything else that canonicalJson would
 * encode differently (class instances, functions) throws.
 */
export function toPlainJson(value: unknown, path = '$'): unknown {
  if (value === null || value === undefined) return null;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      return Number.isFinite(value) ? value : null;
    case 'bigint':
      return value.toString();
    case 'object': {
      if (value instanceof Date) return value.toISOString();
      if (Array.isArray(value)) return value.map((v, i) => toPlainJson(v, `${path}[${i}]`));
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        throw new TypeError(`${path}: ${proto?.constructor?.name ?? 'object'} is not plain JSON`);
      }
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (v === undefined) continue;
        out[k] = toPlainJson(v, `${path}.${k}`);
      }
      return out;
    }
    default:
      throw new TypeError(`${path}: ${typeof value} is not plain JSON`);
  }
}

const isoOrNull = (v: unknown): string | null => {
  if (v === null || v === undefined || v === '') return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const recordOrNull = (v: Record<string, unknown> | null | undefined, path: string) =>
  v == null ? null : (toPlainJson(v, path) as Record<string, unknown>);

export interface TraceDocV2Params {
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
  sourcesUsed: Array<{
    source: string;
    weight: number;
    signal: string;
    rawValue?: number | null;
    signalId?: string | null;
    url?: string | null;
    publisher?: string | null;
    publishedAt?: string | Date | null;
  }>;
  provenance: z.input<typeof TraceProvenanceSchema>;
  betFraction?: number | null;
  betSizeUsdc?: number | null;
  hedgeConditions?: string[] | null;
  hedgePredicates?: HedgePredicate[] | null;
  agentWallet?: string | null;
  forecast?: Record<string, unknown> | null;
  sizing?: Record<string, unknown> | null;
  seedPolicy?: Record<string, unknown> | null;
  correlation?: { pairs: unknown[]; method: 'snapshot' | 'matrix'; snapshotId: string | null } | null;
  corroboration?: { kind: 'CORROBORATED' | 'AUTHORITATIVE' | 'UNCORROBORATED'; units: number; domains: string[] } | null;
}

/**
 * Builds a validated TraceDocV2 (#227) with explicit nulls for every optional
 * field. `now` is passed in (callers use lib/clock) so replays produce
 * identical bytes. The result is final: hash and pin it as returned.
 */
export function buildTraceDocV2(params: TraceDocV2Params, now: Date): TraceDocV2 {
  const onChainId =
    params.onChainMarketId !== null && params.onChainMarketId !== undefined
      ? String(params.onChainMarketId)
      : null;

  const sourcesUsed = (params.sourcesUsed ?? []).slice(0, 50).map((s) => ({
    source: s.source,
    weight: Math.max(0, Math.min(1, s.weight)),
    signal: s.signal,
    rawValue: typeof s.rawValue === 'number' && Number.isFinite(s.rawValue) ? s.rawValue : null,
    signalId: s.signalId ?? null,
    url: s.url ?? null,
    publisher: s.publisher ?? null,
    publishedAt: isoOrNull(s.publishedAt),
  }));

  const ci = {
    lower: Math.min(params.confidenceInterval.lower, params.confidenceInterval.upper),
    upper: Math.max(params.confidenceInterval.lower, params.confidenceInterval.upper),
  };

  const doc = {
    schemaVersion: 2 as const,
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
    createdAt: now.toISOString(),
    provenance: toPlainJson(params.provenance, '$.provenance'),
    forecast: recordOrNull(params.forecast, '$.forecast'),
    sizing: recordOrNull(params.sizing, '$.sizing'),
    seedPolicy: recordOrNull(params.seedPolicy, '$.seedPolicy'),
    correlation: params.correlation
      ? {
          pairs: toPlainJson(params.correlation.pairs ?? [], '$.correlation.pairs') as unknown[],
          method: params.correlation.method,
          snapshotId: params.correlation.snapshotId ?? null,
        }
      : null,
    corroboration: params.corroboration
      ? {
          kind: params.corroboration.kind,
          units: params.corroboration.units,
          domains: [...params.corroboration.domains].sort().slice(0, 50),
        }
      : null,
    hedgePredicates: params.hedgePredicates
      ? params.hedgePredicates.slice(0, MAX_HEDGE_PREDICATES)
      : null,
  };

  return TraceDocV2.parse(doc);
}
