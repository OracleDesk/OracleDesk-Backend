import fs from 'fs';
import path from 'path';

const SCHEMAS_DIR = path.join(__dirname, '..', 'src', 'schemas');

export const TRACE_V1_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://api.oracledesk.io/api/v1/schemas/trace/v1.json',
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

export const QUESTION_V2_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://api.oracledesk.io/api/v1/schemas/question/v2.json',
  title: 'OracleDesk Question Document v2',
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'kind',
    'question',
    'category',
    'contractCategory',
    'closeTime',
    'resolutionSource',
    'resolutionSpecHash',
    'backendMarketId',
  ],
  properties: {
    schemaVersion: { const: 2 },
    kind: { const: 'oracledesk.question' },
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
    resolutionSpecHash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    backendMarketId: { type: 'string', format: 'uuid' },
  },
};

export const QUESTION_V1_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://api.oracledesk.io/api/v1/schemas/question/v1.json',
  title: 'OracleDesk Question Document v1',
  type: 'object',
  additionalProperties: false,
  required: [
    'version',
    'question',
    'category',
    'contractCategory',
    'closeTime',
    'resolutionHash',
    'backendMarketId',
  ],
  properties: {
    version: { const: 1 },
    question: { type: 'string' },
    category: { type: 'string' },
    contractCategory: { type: 'string' },
    closeTime: { type: 'number' },
    resolutionSource: { type: ['string', 'null'] },
    resolutionHash: { type: 'string' },
    backendMarketId: { type: 'string' },
  },
};

export function generateSchemas(opts: { check?: boolean } = {}): boolean {
  const targets = [
    { file: 'trace.schema.json', schema: TRACE_V1_SCHEMA },
    { file: 'question.schema.json', schema: QUESTION_V2_SCHEMA },
    { file: 'question-v1.schema.json', schema: QUESTION_V1_SCHEMA },
  ];

  let matches = true;

  for (const { file, schema } of targets) {
    const dest = path.join(SCHEMAS_DIR, file);
    const content = JSON.stringify(schema, null, 2) + '\n';

    if (opts.check) {
      if (!fs.existsSync(dest)) {
        console.error(`Missing schema file: ${file}`);
        matches = false;
        continue;
      }
      const existing = fs.readFileSync(dest, 'utf8');
      if (existing !== content) {
        console.error(`Schema file out of date: ${file}`);
        matches = false;
      }
    } else {
      fs.writeFileSync(dest, content, 'utf8');
      console.log(`Generated ${dest}`);
    }
  }

  return matches;
}

if (process.argv[1]?.endsWith('gen-schemas.ts')) {
  const isCheck = process.argv.includes('--check');
  const ok = generateSchemas({ check: isCheck });
  if (isCheck && !ok) {
    console.error('JSON schemas are out of date. Run `npm run gen:schemas` to regenerate.');
    process.exit(1);
  }
}
