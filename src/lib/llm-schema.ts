/**
 * Single registry of the shapes we ask LLMs to produce (#65).
 *
 * Each shape is written once in zod. From it we derive:
 *   - `jsonSchema`   → Anthropic tool `input_schema` (forced tool use);
 *   - `geminiSchema` → Gemini `responseSchema` (an OpenAPI-subset dialect);
 *   - `openaiSchema` → OpenAI strict `json_schema` response format (#218).
 *
 * Zod features that have no JSON Schema form (`.catch`, `.default`,
 * transforms) stay out of the *wire* schemas; the lenient domain schemas that
 * apply defaults live next to them. Rules JSON Schema cannot express portably
 * (the confidence interval must contain the probability, expiry must be in the
 * future) are `postValidate` functions whose message is fed back to the model
 * in the repair turn.
 */
import { nowMs } from './clock';
import { SchemaType } from '@google/generative-ai';
import { z } from 'zod';

export type JsonSchema = Record<string, any>;
export type GeminiSchema = Record<string, any>;
export type OpenAISchema = Record<string, any>;

export interface StructuredSpec<T> {
  /** Tool name for Anthropic; also used in logs. */
  name: string;
  description: string;
  zod: z.ZodType<T>;
  jsonSchema: JsonSchema;
  geminiSchema: GeminiSchema;
  /** Strict-mode schema for OpenAI structured outputs (#218). */
  openaiSchema: OpenAISchema;
  /** Cross-field rules. Returns an error message for the repair turn, or null. */
  postValidate?: (value: T) => string | null;
}

export function defineStructured<T>(
  name: string,
  description: string,
  schema: z.ZodType<T>,
  postValidate?: (value: T) => string | null,
): StructuredSpec<T> {
  // Throws on unrepresentable types (the default), so a `.catch`/transform
  // slipped into a wire schema fails at module load, not at the provider.
  const jsonSchema = z.toJSONSchema(schema, { target: 'draft-7', io: 'input' }) as JsonSchema;
  delete jsonSchema.$schema;
  // Like the Gemini dialect, the strict OpenAI form throws at module load
  // when the shape cannot be expressed (#218).
  return {
    name,
    description,
    zod: schema,
    jsonSchema,
    geminiSchema: toGeminiSchema(jsonSchema),
    openaiSchema: toOpenAIStrictSchema(jsonSchema),
    postValidate,
  };
}

const GEMINI_TYPES: Record<string, SchemaType> = {
  object: SchemaType.OBJECT,
  string: SchemaType.STRING,
  number: SchemaType.NUMBER,
  integer: SchemaType.INTEGER,
  boolean: SchemaType.BOOLEAN,
  array: SchemaType.ARRAY,
};

/**
 * Converts a draft-7 JSON Schema to Gemini's response-schema dialect.
 *
 * Kept: type (mapped to SchemaType), enum, required, properties, items,
 * description, minimum/maximum, minItems/maxItems, nullable. Added:
 * propertyOrdering. Dropped (Gemini answers 400 on them): additionalProperties,
 * $schema, minLength/maxLength, pattern, format, default, exclusive bounds.
 * `const` becomes a single-value enum. Everything dropped is still enforced by
 * zod after the call.
 */
export function toGeminiSchema(input: JsonSchema): GeminiSchema {
  let schema = input;

  // anyOf [X, null] → X with nullable.
  let nullable = false;
  if (Array.isArray(schema.anyOf)) {
    const nonNull = schema.anyOf.filter((s: JsonSchema) => s.type !== 'null');
    nullable = nonNull.length !== schema.anyOf.length;
    if (nonNull.length === 1) schema = { ...nonNull[0], description: schema.description ?? nonNull[0].description };
    else throw new Error('Gemini response schemas cannot express a union of several non-null types');
  }
  if (Array.isArray(schema.type)) {
    const types = schema.type.filter((t: string) => t !== 'null');
    nullable = nullable || types.length !== schema.type.length;
    if (types.length !== 1) throw new Error('Gemini response schemas cannot express multi-type unions');
    schema = { ...schema, type: types[0] };
  }

  const out: GeminiSchema = {};
  const type = GEMINI_TYPES[schema.type as string];
  if (!type) throw new Error(`Unsupported JSON Schema type for Gemini: ${String(schema.type)}`);
  out.type = type;
  if (schema.description) out.description = schema.description;
  if (nullable) out.nullable = true;

  if (schema.const !== undefined) {
    out.enum = [String(schema.const)];
    out.format = 'enum';
  } else if (Array.isArray(schema.enum)) {
    out.enum = schema.enum.map(String);
    out.format = 'enum';
  }

  if (type === SchemaType.NUMBER || type === SchemaType.INTEGER) {
    if (typeof schema.minimum === 'number') out.minimum = schema.minimum;
    if (typeof schema.maximum === 'number') out.maximum = schema.maximum;
  }

  if (type === SchemaType.ARRAY) {
    out.items = toGeminiSchema(schema.items ?? { type: 'string' });
    if (typeof schema.minItems === 'number') out.minItems = schema.minItems;
    if (typeof schema.maxItems === 'number') out.maxItems = schema.maxItems;
  }

  if (type === SchemaType.OBJECT) {
    const props: Record<string, JsonSchema> = schema.properties ?? {};
    out.properties = Object.fromEntries(Object.entries(props).map(([k, v]) => [k, toGeminiSchema(v)]));
    out.propertyOrdering = Object.keys(props);
    if (Array.isArray(schema.required) && schema.required.length > 0) out.required = [...schema.required];
  }

  return out;
}

// ─── OpenAI strict json_schema (#218) ─────────────────────────────────────────

/**
 * Keywords kept in the strict schema. Deliberately small: strict mode answers
 * 400 on keywords it does not support, and support for bounds (`minimum`,
 * `maxItems`, `pattern`, ...) varies by model. Everything dropped is still
 * enforced by zod after the call and reaches the model in the repair turn.
 */
export const OPENAI_STRICT_KEYWORDS = [
  'type', 'description', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'anyOf',
] as const;

/** Strict mode limits nesting depth; deeper shapes are refused at definition time. */
const OPENAI_MAX_DEPTH = 10;

const OPENAI_TYPES = new Set(['object', 'string', 'number', 'integer', 'boolean', 'array', 'null']);

/**
 * Converts a draft-7 JSON Schema to OpenAI's strict `json_schema` subset:
 * every object gets `additionalProperties: false` and lists every property in
 * `required`; a property that was optional becomes `anyOf: [X, { type: 'null' }]`
 * (the adapter turns those nulls back into absent keys before zod, see
 * `dropOptionalNulls`). `const` becomes a one-value `enum`, a type array
 * becomes `anyOf`, and keywords outside OPENAI_STRICT_KEYWORDS are dropped.
 *
 * Throws when a shape cannot be expressed strictly: a non-object root, a map
 * (`additionalProperties` schema with no fixed properties), a missing type, or
 * nesting deeper than strict mode accepts.
 */
export function toOpenAIStrictSchema(input: JsonSchema): OpenAISchema {
  if (input.type !== 'object') throw new Error('OpenAI strict schemas need an object at the root');
  return strictNode(input, 1);
}

function strictNode(schema: JsonSchema, depth: number): OpenAISchema {
  if (depth > OPENAI_MAX_DEPTH) throw new Error(`OpenAI strict schemas cannot nest deeper than ${OPENAI_MAX_DEPTH} levels`);

  if (Array.isArray(schema.anyOf)) {
    const out: OpenAISchema = { anyOf: schema.anyOf.map((s: JsonSchema) => strictNode(s, depth)) };
    if (schema.description) out.description = schema.description;
    return out;
  }
  if (Array.isArray(schema.type)) {
    const { type, ...rest } = schema;
    return strictNode({ anyOf: (type as string[]).map((t) => ({ ...rest, type: t })), description: schema.description }, depth);
  }
  if (typeof schema.type !== 'string' || !OPENAI_TYPES.has(schema.type)) {
    throw new Error(`Unsupported JSON Schema type for OpenAI strict mode: ${String(schema.type)}`);
  }

  const out: OpenAISchema = { type: schema.type };
  if (schema.description) out.description = schema.description;
  if (schema.const !== undefined) out.enum = [schema.const];
  else if (Array.isArray(schema.enum)) out.enum = [...schema.enum];

  if (schema.type === 'array') {
    out.items = strictNode(schema.items ?? { type: 'string' }, depth + 1);
  }

  if (schema.type === 'object') {
    const props: Record<string, JsonSchema> = schema.properties ?? {};
    if (Object.keys(props).length === 0 && schema.additionalProperties && schema.additionalProperties !== false) {
      throw new Error('OpenAI strict schemas cannot express a map with free-form keys');
    }
    const required = new Set<string>(Array.isArray(schema.required) ? schema.required : []);
    out.properties = Object.fromEntries(
      Object.entries(props).map(([k, v]) => {
        const node = strictNode(v, depth + 1);
        return [k, required.has(k) ? node : nullable(node)];
      }),
    );
    out.required = Object.keys(props);
    out.additionalProperties = false;
  }

  for (const key of Object.keys(out)) {
    if (!(OPENAI_STRICT_KEYWORDS as readonly string[]).includes(key)) delete out[key];
  }
  return out;
}

function nullable(node: OpenAISchema): OpenAISchema {
  if (Array.isArray(node.anyOf)) {
    return node.anyOf.some((s: OpenAISchema) => s.type === 'null') ? node : { ...node, anyOf: [...node.anyOf, { type: 'null' }] };
  }
  return { anyOf: [node, { type: 'null' }] };
}

/**
 * Strict mode makes the model send `null` for a property that was optional in
 * the wire schema; zod's `.optional()` rejects null. Deletes those keys
 * (recursively, objects and arrays) so the value means what the model meant.
 * Nulls the wire schema itself allows are kept. Returns a new value.
 */
export function dropOptionalNulls(schema: JsonSchema | undefined, value: unknown): unknown {
  if (!schema || value === null || typeof value !== 'object') return value;
  if (Array.isArray(schema.anyOf)) {
    const branch = schema.anyOf.find((s: JsonSchema) =>
      Array.isArray(value) ? s.type === 'array' : s.type === 'object');
    return dropOptionalNulls(branch, value);
  }
  if (Array.isArray(value)) {
    return schema.type === 'array' ? value.map((v) => dropOptionalNulls(schema.items, v)) : value;
  }
  if (schema.type !== 'object') return value;
  const props: Record<string, JsonSchema> = schema.properties ?? {};
  const required = new Set<string>(Array.isArray(schema.required) ? schema.required : []);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === null && !required.has(k) && props[k] && !allowsNull(props[k])) continue;
    out[k] = dropOptionalNulls(props[k], v);
  }
  return out;
}

function allowsNull(schema: JsonSchema): boolean {
  if (schema.type === 'null' || (Array.isArray(schema.type) && schema.type.includes('null'))) return true;
  return Array.isArray(schema.anyOf) && schema.anyOf.some(allowsNull);
}

/** Formats zod issues for a repair turn. Never includes the model's raw output. */
export function formatIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 12)
    .map((i) => `- ${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`)
    .join('\n');
}

// ─── Market proposal ──────────────────────────────────────────────────────────

export const MARKET_CATEGORIES = [
  'FED', 'ECB', 'ELECTION', 'GEOPOLITICAL', 'CRYPTO', 'MACRO', 'SPORTS', 'ENTERTAINMENT', 'POLITICS',
] as const;

/**
 * Bounds on `minimum_liquidity_usdc` enforced at the LLM boundary (#239).
 * The model emits a number; the backend converts it exactly once to a raw
 * bigint via `proposalLiquidityRaw` below, so no float arithmetic ever
 * touches the money path. Values outside `[LIQ_MIN, LIQ_MAX]` or with more
 * than two decimal places are rejected rather than silently clamped.
 */
export const LIQ_MIN_USDC = 10;
export const LIQ_MAX_USDC = 100_000;

/** What the model must produce. Strict: a bad currency is an error, not masked. */
export const marketProposalWireSchema = z.object({
  market_question: z.string().min(10),
  initial_yes_probability: z.number().min(0.01).max(0.99),
  resolution_oracle: z.string().min(1),
  expiry_timestamp: z.number().int().positive(),
  settlement_currency: z.literal('USDC'),
  minimum_liquidity_usdc: z
    .number()
    .finite()
    .min(LIQ_MIN_USDC)
    .max(LIQ_MAX_USDC)
    .refine((n) => Number.isInteger(n * 100), {
      message: `minimum_liquidity_usdc must have at most 2 decimal places`,
    }),
  category: z.enum(MARKET_CATEGORIES),
  confidence_interval: z.object({ lower: z.number(), upper: z.number() }),
  reasoning: z.string().min(1),
  /** Ids of the untrusted signals the question is grounded in (#70). */
  grounding_signal_ids: z.array(z.string()).min(1).max(5),
  /**
   * Optional structured price fields (#90). Present only when the model chose a
   * Reflector-priced CRYPTO market; the backend renders the question from them
   * so text and the committed price spec cannot disagree.
   */
  price_asset: z.string().min(1).optional(),
  price_threshold: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  price_direction: z.enum(['Above', 'AtOrAbove', 'Below', 'AtOrBelow']).optional(),
  price_close_timestamp: z.number().int().positive().optional(),
});

/**
 * Domain parse, lenient where intended: the currency is always USDC and the
 * minimum liquidity defaults to 100 when an older producer omitted them.
 * The boundary checks on `minimum_liquidity_usdc` inherited from
 * `marketProposalWireSchema.extend()` still apply to the default.
 */
export const marketProposalSchema = marketProposalWireSchema.extend({
  settlement_currency: z.literal('USDC').catch('USDC'),
  minimum_liquidity_usdc: z
    .number()
    .finite()
    .min(LIQ_MIN_USDC)
    .max(LIQ_MAX_USDC)
    .refine((n) => Number.isInteger(n * 100), {
      message: `minimum_liquidity_usdc must have at most 2 decimal places`,
    })
    .default(100),
});

export type MarketProposalWire = z.infer<typeof marketProposalWireSchema>;

/**
 * Converts a validated proposal's `minimum_liquidity_usdc` to a raw bigint
 * (USDC × 10^7, the on-chain unit) through a fixed-decimal string, exactly
 * once. The seed policy and the chain writer take only `bigint` from here.
 */
export function proposalLiquidityRaw(
  p: Pick<MarketProposalWire, 'minimum_liquidity_usdc'>,
): bigint {
  // Lazy import avoids a circular dep at module load.
  const { parseUsdc } = require('./amounts') as typeof import('./amounts');
  return parseUsdc(p.minimum_liquidity_usdc.toFixed(2));
}

/** The probability must lie inside a non-empty confidence interval. */
export function confidenceIntervalError(
  p: Pick<MarketProposalWire, 'initial_yes_probability' | 'confidence_interval'>,
): string | null {
  const { initial_yes_probability: prob, confidence_interval: ci } = p;
  if (ci.lower >= ci.upper || prob < ci.lower || prob > ci.upper) {
    return `confidence_interval must satisfy lower < initial_yes_probability (${prob}) < upper, with lower < upper; got lower=${ci.lower}, upper=${ci.upper}.`;
  }
  return null;
}

/**
 * Cross-field rules JSON Schema cannot state. The 1–90 day window is a policy
 * check in the guard (it must reject, not repair); here the expiry only has to
 * be in the future.
 */
export function marketProposalPostValidate(p: MarketProposalWire, nowSeconds = Math.floor(nowMs() / 1000)): string | null {
  const ci = confidenceIntervalError(p);
  if (ci) return ci;
  if (p.expiry_timestamp <= nowSeconds) {
    return `expiry_timestamp must be a unix time in seconds in the future (now is ${nowSeconds}); got ${p.expiry_timestamp}.`;
  }
  return null;
}

export const marketProposalSpec = defineStructured(
  'submit_market_proposal',
  'Submit exactly one binary prediction market proposal derived from the provided signals.',
  marketProposalWireSchema,
  (p) => marketProposalPostValidate(p),
);

// ─── Trace reasoning ──────────────────────────────────────────────────────────

export const traceReasoningSchema = z.object({
  hedge_conditions: z.array(z.string()),
  reasoning_summary: z.string().min(10),
  key_signals: z.array(z.string()),
  risk_factors: z.array(z.string()),
});

export const traceReasoningSpec = defineStructured(
  'submit_trade_reasoning',
  'Submit hedge conditions and a reasoning summary for a trading position.',
  traceReasoningSchema,
);
