import fs from 'fs';
import path from 'path';

/**
 * Single source of truth for the JSON Schemas served at `/api/v1/schemas/*`
 * and committed at `src/schemas/*.schema.json`.
 *
 * Lives inside `src/` (not `scripts/`) so the route module and the CLI can
 * both import from the same path without reaching outside the TypeScript
 * `rootDir`. The committed files use the canonical base URL and the route
 * rewrites `$id` from `PUBLIC_API_BASE_URL` on each request.
 */

/**
 * The committed files live in <repo>/src/schemas. This module also runs
 * compiled from dist/ and dist-tests/, so the repo root is found by walking up
 * to package.json rather than assumed to be next to __dirname.
 */
function schemasDir(): string {
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return path.join(dir, 'src', 'schemas');
    dir = path.dirname(dir);
  }
  return __dirname;
}
const SCHEMAS_DIR = schemasDir();
const CANONICAL_BASE = 'https://api.oracledesk.io';

export const TRACE_V1_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `${CANONICAL_BASE}/api/v1/schemas/trace/v1.json`,
  title: 'OracleDesk Reasoning Trace v1',
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'kind',
    'traceId',
    'agentType',
    'decisionType',
    'action',
    'market',
    'probabilityEstimate',
    'marketProbability',
    'edge',
    'confidenceInterval',
    'sourcesUsed',
    'betFraction',
    'betSizeUsdc',
    'hedgeConditions',
    'agentWallet',
    'createdAt',
  ],
  properties: {
    schemaVersion: { const: 1 },
    kind: { const: 'oracledesk.trace' },
    traceId: { type: 'string', format: 'uuid' },
    agentType: { type: 'string', enum: ['MARKET_MAKER', 'TRADER'] },
    decisionType: { type: 'string', minLength: 1, maxLength: 64 },
    action: { type: 'string', minLength: 1, maxLength: 64 },
    market: {
      type: 'object',
      additionalProperties: false,
      required: ['backendId', 'onChainId'],
      properties: {
        backendId: { type: 'string', format: 'uuid' },
        onChainId: { type: ['string', 'null'], pattern: '^[0-9]+$' },
      },
    },
    probabilityEstimate: { type: 'number', minimum: 0, maximum: 1 },
    marketProbability: { type: 'number', minimum: 0, maximum: 1 },
    edge: { type: 'number', minimum: -1, maximum: 1 },
    confidenceInterval: {
      type: 'object',
      description: 'lower must be <= upper',
      additionalProperties: false,
      required: ['lower', 'upper'],
      properties: {
        lower: { type: 'number' },
        upper: { type: 'number' },
      },
    },
    sourcesUsed: {
      type: 'array',
      maxItems: 50,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['source', 'weight', 'signal', 'rawValue'],
        properties: {
          source: { type: 'string' },
          weight: { type: 'number', minimum: 0, maximum: 1 },
          signal: { type: 'string' },
          rawValue: { type: ['number', 'null'] },
        },
      },
    },
    citedSourceIds: {
      type: 'array',
      maxItems: 50,
      items: { type: 'string' },
    },
    betFraction: { type: ['number', 'null'] },
    betSizeUsdc: { type: ['number', 'null'] },
    hedgeConditions: {
      type: 'array',
      maxItems: 20,
      items: { type: 'string', maxLength: 500 },
    },
    agentWallet: { type: ['string', 'null'] },
    createdAt: { type: 'string', format: 'date-time' },
  },
};

const PROVENANCE_ENTRY_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: [
        'source', 'provider', 'model', 'promptId', 'promptVersion', 'promptHash',
        'params', 'usage', 'latencyMs', 'attempts', 'outputSha256',
      ],
      properties: {
        source: { const: 'llm' },
        provider: { type: 'string', enum: ['anthropic', 'gemini'] },
        model: { type: 'string' },
        promptId: { type: 'string' },
        promptVersion: { type: 'integer' },
        promptHash: { type: 'string' },
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['temperature', 'maxTokens'],
          properties: { temperature: { type: 'number' }, maxTokens: { type: 'integer' } },
        },
        usage: {
          type: ['object', 'null'],
          additionalProperties: false,
          required: ['inputTokens', 'outputTokens'],
          properties: { inputTokens: { type: 'integer' }, outputTokens: { type: 'integer' } },
        },
        latencyMs: { type: 'number' },
        attempts: { type: 'integer' },
        fallbackFrom: {
          type: 'object',
          additionalProperties: false,
          required: ['provider', 'model', 'errorClass'],
          properties: {
            provider: { type: 'string', enum: ['anthropic', 'gemini'] },
            model: { type: 'string' },
            errorClass: { type: 'string' },
          },
        },
        outputSha256: { type: 'string' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['source', 'promptId', 'promptVersion', 'reason'],
      properties: {
        source: { const: 'default' },
        promptId: { type: 'string' },
        promptVersion: { type: 'integer' },
        reason: { type: 'string', enum: ['LLM_FAILED', 'LLM_BUDGET_EXCEEDED'] },
      },
    },
  ],
};

/**
 * Trace v2 (#227): v1 plus provenance, forecast, sizing, seed policy,
 * correlation and full evidence. Every added key is required (null when not
 * applicable), matching the explicit-null rule in docs/trace-format.md §2.
 */
export const TRACE_V2_SCHEMA = {
  ...TRACE_V1_SCHEMA,
  $id: `${CANONICAL_BASE}/api/v1/schemas/trace/v2.json`,
  title: 'OracleDesk Reasoning Trace v2',
  required: [...TRACE_V1_SCHEMA.required, 'provenance', 'forecast', 'sizing', 'seedPolicy', 'correlation', 'corroboration'],
  properties: {
    ...TRACE_V1_SCHEMA.properties,
    schemaVersion: { const: 2 },
    sourcesUsed: {
      type: 'array',
      maxItems: 50,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['source', 'weight', 'signal', 'rawValue', 'signalId', 'url', 'publisher', 'publishedAt'],
        properties: {
          source: { type: 'string' },
          weight: { type: 'number', minimum: 0, maximum: 1 },
          signal: { type: 'string' },
          rawValue: { type: ['number', 'null'] },
          signalId: { type: ['string', 'null'] },
          url: { type: ['string', 'null'], format: 'uri' },
          publisher: { type: ['string', 'null'] },
          publishedAt: { type: ['string', 'null'], format: 'date-time' },
        },
      },
    },
    provenance: {
      type: 'object',
      additionalProperties: false,
      required: ['schema', 'llm', 'generator'],
      properties: {
        schema: { const: 'oracledesk.trace.provenance/1' },
        llm: { type: 'array', minItems: 1, items: PROVENANCE_ENTRY_SCHEMA },
        generator: {
          type: 'object',
          additionalProperties: false,
          required: ['service', 'version'],
          properties: {
            service: { const: 'oracledesk-backend' },
            version: { type: 'string' },
            commit: { type: 'string' },
          },
        },
      },
    },
    forecast: { type: ['object', 'null'] },
    sizing: { type: ['object', 'null'] },
    seedPolicy: { type: ['object', 'null'] },
    correlation: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['pairs', 'method', 'snapshotId'],
      properties: {
        pairs: { type: 'array' },
        method: { type: 'string', enum: ['snapshot', 'matrix'] },
        snapshotId: { type: ['string', 'null'] },
      },
    },
    corroboration: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['kind', 'units', 'domains'],
      properties: {
        kind: { type: 'string', enum: ['CORROBORATED', 'AUTHORITATIVE', 'UNCORROBORATED'] },
        units: { type: 'integer', minimum: 0 },
        domains: { type: 'array', maxItems: 50, items: { type: 'string' } },
      },
    },
    hedgePredicates: {
      type: ['array', 'null'],
      maxItems: 10,
      items: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'version', 'kind', 'seriesId', 'comparator', 'threshold', 'unit', 'action', 'description'],
            properties: {
              id: { type: 'string', minLength: 1, maxLength: 32 },
              version: { const: 1 },
              kind: { const: 'fred_series' },
              seriesId: { type: 'string', enum: ['FEDFUNDS', 'CPIAUCSL', 'UNRATE', 'T10Y2Y'] },
              comparator: { type: 'string', enum: ['gt', 'gte', 'lt', 'lte'] },
              threshold: { type: 'number' },
              unit: { type: 'string', enum: ['percent', 'index', 'spread'] },
              action: { type: 'string', enum: ['EXIT', 'REFORECAST'] },
              description: { type: 'string', minLength: 1, maxLength: 500 },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'version', 'kind', 'entities', 'comparator', 'threshold', 'windowHours', 'unit', 'action', 'description'],
            properties: {
              id: { type: 'string', minLength: 1, maxLength: 32 },
              version: { const: 1 },
              kind: { const: 'news_entity_count' },
              entities: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'string', minLength: 1, maxLength: 64 } },
              comparator: { type: 'string', enum: ['gt', 'gte', 'lt', 'lte'] },
              threshold: { type: 'integer', minimum: 1, maximum: 1000 },
              windowHours: { type: 'integer', minimum: 1, maximum: 720 },
              unit: { const: 'articles' },
              action: { type: 'string', enum: ['EXIT', 'REFORECAST'] },
              description: { type: 'string', minLength: 1, maxLength: 500 },
            },
          },
        ],
      },
    },
  },
};

/**
 * Shared question-document properties. Both v1 and v2 pin the same core
 * shape; v2 additionally carries a `resolution` block (#74), and either
 * version may carry an optional `priceResolution` block (#90).
 */
const QUESTION_COMMON_PROPERTIES = {
  question: { type: 'string', minLength: 1 },
  category: {
    type: 'string',
    enum: [
      'FED',
      'ECB',
      'MACRO',
      'GEOPOLITICAL',
      'ELECTION',
      'POLITICS',
      'CRYPTO',
      'SPORTS',
      'ENTERTAINMENT',
    ],
  },
  contractCategory: {
    type: 'string',
    enum: ['Macro', 'Geopolitics', 'Crypto', 'Sports', 'Culture', 'Other'],
  },
  closeTime: { type: 'integer' },
  resolutionSource: { type: ['string', 'null'] },
  resolutionHash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
  backendMarketId: { type: 'string', format: 'uuid' },
  priceResolution: {
    type: 'object',
    additionalProperties: true,
    required: ['kind', 'reflector', 'asset', 'assetKind', 'threshold', 'direction', 'maxStaleness'],
    properties: {
      kind: { const: 'price' },
      reflector: { type: 'string' },
      asset: { type: 'string' },
      assetKind: { type: 'string' },
      threshold: { type: ['number', 'string'] },
      direction: { type: 'string' },
      maxStaleness: { type: 'integer', minimum: 0 },
    },
  },
} as const;

const QUESTION_COMMON_REQUIRED = [
  'question',
  'category',
  'contractCategory',
  'closeTime',
  'resolutionSource',
  'resolutionHash',
  'backendMarketId',
] as const;

export const QUESTION_V1_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `${CANONICAL_BASE}/api/v1/schemas/question/v1.json`,
  title: 'OracleDesk Question Document v1',
  type: 'object',
  additionalProperties: false,
  required: ['version', ...QUESTION_COMMON_REQUIRED],
  properties: {
    version: { const: 1 },
    ...QUESTION_COMMON_PROPERTIES,
  },
};

export const QUESTION_V2_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `${CANONICAL_BASE}/api/v1/schemas/question/v2.json`,
  title: 'OracleDesk Question Document v2',
  type: 'object',
  additionalProperties: false,
  required: ['version', ...QUESTION_COMMON_REQUIRED, 'resolution'],
  properties: {
    version: { const: 2 },
    ...QUESTION_COMMON_PROPERTIES,
    resolution: { type: 'object', additionalProperties: true },
  },
};

export const REPORT_V2_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `${CANONICAL_BASE}/api/v1/schemas/report/v2.json`,
  title: 'OracleDesk Transparency Report v2',
  type: 'object',
  additionalProperties: false,
  required: [
    'kind',
    'schemaVersion',
    'network',
    'contracts',
    'agent',
    'period',
    'anchor',
    'consistency',
    'treasury',
    'chain',
    'reconciliation',
    'markets',
    'totals',
    'period_flows',
    'traces',
    'method',
    'previous',
  ],
  properties: {
    kind: { const: 'oracledesk.transparency-report' },
    schemaVersion: { const: 2 },
    network: { type: 'string' },
    contracts: {
      type: 'object',
      additionalProperties: false,
      required: ['treasury', 'marketCore', 'usdc', 'reasoningRegistry'],
      properties: {
        treasury: { type: 'string' },
        marketCore: { type: 'string' },
        usdc: { type: 'string' },
        reasoningRegistry: { type: 'string' },
      },
    },
    agent: { type: 'string' },
    period: {
      type: 'object',
      additionalProperties: false,
      required: ['from', 'to'],
      properties: {
        from: { type: 'string', format: 'date-time' },
        to: { type: 'string', format: 'date-time' },
      },
    },
    anchor: {
      type: 'object',
      additionalProperties: false,
      required: ['ledger', 'closedAt'],
      properties: {
        ledger: { type: 'integer', minimum: 0 },
        closedAt: { type: 'string', format: 'date-time' },
      },
    },
    consistency: { type: 'string', enum: ['exact', 'best_effort'] },
    treasury: {
      type: 'object',
      additionalProperties: false,
      required: ['usdcBalanceRaw', 'availableCapitalRaw', 'riskConfig', 'dailyUsage'],
      properties: {
        usdcBalanceRaw: { type: 'string', pattern: '^-?\\d+$' },
        availableCapitalRaw: { type: 'string', pattern: '^-?\\d+$' },
        riskConfig: {
          type: 'object',
          additionalProperties: false,
          required: ['maxTradeRaw', 'maxMarketRaw', 'maxDailyRaw'],
          properties: {
            maxTradeRaw: { type: 'string', pattern: '^\\d+$' },
            maxMarketRaw: { type: 'string', pattern: '^\\d+$' },
            maxDailyRaw: { type: 'string', pattern: '^\\d+$' },
          },
        },
        dailyUsage: {
          type: 'object',
          additionalProperties: false,
          required: ['amountRaw', 'dayStart'],
          properties: {
            amountRaw: { type: 'string', pattern: '^\\d+$' },
            dayStart: { type: 'integer', minimum: 0 },
          },
        },
      },
    },
    chain: {
      type: 'object',
      additionalProperties: false,
      required: [
        'navRaw',
        'liquidRaw',
        'yieldPrincipalRaw',
        'yieldValueShares',
        'queueReservedRaw',
        'netExposureRaw',
        'ledger',
      ],
      properties: {
        navRaw: { type: 'string', pattern: '^-?\\d+$' },
        liquidRaw: { type: 'string', pattern: '^-?\\d+$' },
        yieldPrincipalRaw: { type: 'string', pattern: '^-?\\d+$' },
        yieldValueShares: { type: ['string', 'null'], pattern: '^-?\\d+$' },
        queueReservedRaw: { type: 'string', pattern: '^-?\\d+$' },
        netExposureRaw: { type: 'string', pattern: '^-?\\d+$' },
        ledger: { type: 'integer', minimum: 0 },
      },
    },
    reconciliation: {
      type: 'object',
      additionalProperties: false,
      required: ['navDiffRaw', 'perMarket', 'flags'],
      properties: {
        navDiffRaw: { type: 'string', pattern: '^-?\\d+$' },
        perMarket: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['marketId', 'chainFloorRaw', 'recomputedFloorRaw', 'diffRaw'],
            properties: {
              marketId: { type: 'string', pattern: '^\\d+$' },
              chainFloorRaw: { type: 'string', pattern: '^-?\\d+$' },
              recomputedFloorRaw: { type: 'string', pattern: '^-?\\d+$' },
              diffRaw: { type: 'string', pattern: '^-?\\d+$' },
            },
          },
        },
        flags: {
          type: 'array',
          items: {
            type: 'string',
            enum: [
              'NAV_EXCLUDES_YIELD',
              'YIELD_VALUE_IN_SHARES',
              'YIELD_READ_FAILED',
              'AVAILABLE_MIXES_UNITS',
              'NAV_DIFF_EXCEEDS_TOLERANCE',
            ],
          },
        },
      },
    },
    markets: {
      type: 'array',
      items: { type: 'object', additionalProperties: true },
    },
    totals: {
      type: 'object',
      additionalProperties: false,
      required: ['positionsMarkRaw', 'positionsLiquidationRaw', 'navRaw'],
      properties: {
        positionsMarkRaw: { type: 'string', pattern: '^-?\\d+$' },
        positionsLiquidationRaw: { type: 'string', pattern: '^-?\\d+$' },
        navRaw: { type: 'string', pattern: '^-?\\d+$' },
      },
    },
    period_flows: {
      type: 'object',
      additionalProperties: true,
    },
    traces: {
      type: 'object',
      additionalProperties: false,
      required: ['total', 'byAction'],
      properties: {
        total: { type: 'integer', minimum: 0 },
        byAction: { type: 'object', additionalProperties: { type: 'integer', minimum: 0 } },
      },
    },
    method: {
      type: 'object',
      additionalProperties: false,
      required: ['version', 'doc'],
      properties: {
        version: { const: '2' },
        doc: { type: 'string' },
      },
    },
    previous: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['onChainTraceId', 'traceHash'],
      properties: {
        onChainTraceId: { type: 'string', pattern: '^\\d+$' },
        traceHash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
      },
    },
  },
};

export interface SchemaTarget {
  file: string;
  path: string;
  schema: Record<string, unknown>;
  title: string;
}

export const SCHEMA_TARGETS: SchemaTarget[] = [
  { file: 'trace.schema.json', path: 'trace/v1.json', schema: TRACE_V1_SCHEMA, title: 'Reasoning Trace v1' },
  { file: 'trace-v2.schema.json', path: 'trace/v2.json', schema: TRACE_V2_SCHEMA, title: 'Reasoning Trace v2' },
  { file: 'question.schema.json', path: 'question/v2.json', schema: QUESTION_V2_SCHEMA, title: 'Question v2' },
  { file: 'question-v1.schema.json', path: 'question/v1.json', schema: QUESTION_V1_SCHEMA, title: 'Question v1' },
  { file: 'report.schema.json', path: 'report/v2.json', schema: REPORT_V2_SCHEMA, title: 'Transparency Report v2' },
];

export function jsonSchemaFor(target: SchemaTarget, baseUrl: string): Record<string, unknown> {
  return {
    ...target.schema,
    $id: `${baseUrl.replace(/\/$/, '')}/api/v1/schemas/${target.path}`,
  };
}

/**
 * Writes or checks the committed JSON Schema files. `check` mode returns
 * `false` on any drift (prints which files are stale); `write` mode
 * overwrites them. The committed files always use the canonical base URL.
 */
export function generateSchemas(opts: { check?: boolean } = {}): boolean {
  let matches = true;

  for (const target of SCHEMA_TARGETS) {
    const dest = path.join(SCHEMAS_DIR, target.file);
    const content = JSON.stringify(target.schema, null, 2) + '\n';

    if (opts.check) {
      if (!fs.existsSync(dest)) {
        console.error(`Missing schema file: ${target.file}`);
        matches = false;
        continue;
      }
      const existing = fs.readFileSync(dest, 'utf8');
      if (existing !== content) {
        console.error(`Schema file out of date: ${target.file}`);
        matches = false;
      }
    } else {
      fs.writeFileSync(dest, content, 'utf8');
      console.log(`Generated ${dest}`);
    }
  }

  return matches;
}
