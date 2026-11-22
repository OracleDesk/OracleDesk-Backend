import fs from 'node:fs';
import crypto from 'crypto';
import os from 'os';
import dotenv from 'dotenv';
import { Keypair, Networks, StrKey } from '@stellar/stellar-sdk';
import { z } from 'zod';
import { resolveFileVars, validateSecrets, SECRET_NAMES } from './secrets';
import { applyDeprecatedAliases, collectConfigWarnings, emitConfigWarnings } from './meta';
import { generateEntitlementKey } from '../services/entitlement/keys';

dotenv.config();

const optionalString = z.string().default('');

const stellarAccount = z
  .string()
  .refine((v) => StrKey.isValidEd25519PublicKey(v), 'must be a G… Stellar public key');

const optionalContract = z
  .string()
  .default('')
  .refine((v) => v === '' || StrKey.isValidContract(v), 'must be a C… Stellar contract id');

const optionalAddress = z
  .string()
  .default('')
  .refine(
    (v) => v === '' || StrKey.isValidEd25519PublicKey(v) || StrKey.isValidContract(v),
    'must be a G… account or C… contract address',
  );

/** Base units (7-decimal USDC) as a decimal string, parsed to a bigint. */
const rawUsdc = (fallback: string) =>
  z.string().default(fallback).refine((v) => /^\d+$/.test(v), 'must be an integer in 7-decimal base units').transform((v) => BigInt(v));

const SEED_CATEGORIES = ['FED', 'ECB', 'MACRO', 'ELECTION', 'GEOPOLITICAL', 'CRYPTO', 'POLITICS', 'SPORTS', 'ENTERTAINMENT'] as const;

/** JSON map of market category → base seed in USDC. */
const seedCategoryBase = z
  .string()
  .default(JSON.stringify({ FED: 300, ECB: 250, MACRO: 200, CRYPTO: 200, ELECTION: 200, GEOPOLITICAL: 150, POLITICS: 150, SPORTS: 120, ENTERTAINMENT: 100 }))
  .transform((v, ctx) => {
    try {
      return JSON.parse(v) as unknown;
    } catch {
      ctx.addIssue({ code: 'custom', message: 'must be a JSON object of category → USDC' });
      return z.NEVER;
    }
  })
  .pipe(
    z.record(z.string(), z.number().positive()).refine(
      (m) => Object.keys(m).every((k) => (SEED_CATEGORIES as readonly string[]).includes(k)),
      `keys must be market categories: ${SEED_CATEGORIES.join(', ')}`,
    ),
  );

// ── Price-mode feed registry (#90) ──────────────────────────────────────────
// REFLECTOR_FEEDS_JSON is a JSON object keyed by network passphrase → asset
// symbol → feed. Addresses are cited, never hard-coded. Empty disables price
// mode (every market falls back to signer mode).
const reflectorFeedSchema = z.object({
  reflector: z.string().refine((v) => StrKey.isValidContract(v), 'must be a C… Stellar contract id'),
  asset: z.union([
    z.object({ kind: z.literal('other'), symbol: z.string().min(1) }),
    z.object({
      kind: z.literal('stellar'),
      address: z
        .string()
        .refine((v) => StrKey.isValidEd25519PublicKey(v) || StrKey.isValidContract(v), 'must be a G… or C… address'),
    }),
  ]),
  quote: z.literal('USD'),
  maxStaleness: z.number().int().positive(),
  source: z.string().url(),
});

const reflectorFeeds = z
  .string()
  .default('{}')
  .transform((v, ctx) => {
    try {
      return JSON.parse(v) as unknown;
    } catch {
      ctx.addIssue({ code: 'custom', message: 'must be a JSON object keyed by network passphrase → symbol → feed' });
      return z.NEVER;
    }
  })
  .pipe(z.record(z.string(), z.record(z.string(), reflectorFeedSchema)));

// outbox, signers and channels are the chain-write probes (#220); they are only
// ever critical on an instance that writes (see isChainWriter in health.service).
export const PROBE_NAMES = ['database', 'redis', 'rpc', 'indexer', 'outbox', 'signers', 'channels'] as const;

const probeName = z
  .string()
  .refine((v) => (PROBE_NAMES as readonly string[]).includes(v), `must be one of ${PROBE_NAMES.join(', ')}`);

const commaList = (item: z.ZodType<string, string>, fallback = "") =>
  z
    .string()
    .default(fallback)
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean))
    .pipe(z.array(item));

/**
 * `AUTH_PREVIOUS_SIGNING_KEYS`: comma-separated `G…[@ISO-8601]` entries (#48).
 * Only public keys are accepted; a secret seed is not a valid previous key.
 */
export interface PreviousSigningKey {
  publicKey: string;
  /** When set, the key stops verifying challenges after this instant. */
  retireAt: Date | null;
}

const previousSigningKeys = z
  .string()
  .default('')
  .transform((value, ctx) => {
    const out: PreviousSigningKey[] = [];
    for (const raw of value.split(',')) {
      const item = raw.trim();
      if (!item) continue;
      const at = item.indexOf('@');
      const publicKey = (at === -1 ? item : item.slice(0, at)).trim();
      const retireRaw = at === -1 ? '' : item.slice(at + 1).trim();
      if (!StrKey.isValidEd25519PublicKey(publicKey)) {
        ctx.addIssue({
          code: 'custom',
          message: `"${publicKey}" must be a G… Stellar public key (never a secret)`,
        });
        continue;
      }
      let retireAt: Date | null = null;
      if (retireRaw) {
        const ms = Date.parse(retireRaw);
        if (Number.isNaN(ms)) {
          ctx.addIssue({ code: 'custom', message: `"${retireRaw}" must be an ISO-8601 retirement time` });
          continue;
        }
        retireAt = new Date(ms);
      }
      out.push({ publicKey, retireAt });
    }
    return out;
  });

/** `true`/`false`, with the default used when unset. */
const boolDefault = (fallback: 'true' | 'false') =>
  z.enum(['true', 'false']).default(fallback).transform((v) => v === 'true');

// The plain object schema (#243): its `.shape` lists every key, which the
// lifecycle metadata in ./meta.ts and the boot warnings are checked against.
export const envObjectSchema = z
  .object({
    DATABASE_URL: z.string({ error: 'is required' }).min(1, 'is required'),
    PORT: z.string().default('8000').transform(Number),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    // Process role for split Kubernetes deployments (#272): all (default), api, indexer, or worker.
    PROCESS_ROLE: z.enum(['all', 'api', 'indexer', 'worker']).default('all'),
    // Multi-provider IPFS replication and hedged gateway settings (#271).
    IPFS_PROVIDERS: commaList(z.enum(['pinata', 'kubo', 'psa']), 'pinata'),
    IPFS_KUBO_API_URL: optionalString,
    IPFS_KUBO_AUTH: optionalString,
    IPFS_PSA_ENDPOINT: optionalString,
    IPFS_PSA_TOKEN: optionalString,
    IPFS_MIN_REPLICAS: z.string().default('1').transform(Number).pipe(z.number().int().min(1).max(10)),
    IPFS_GATEWAYS: commaList(z.string().url(), ''),
    IPFS_HEDGE_DELAY_MS: z.string().default('750').transform(Number).pipe(z.number().int().min(50).max(30000)),
    IPFS_SINGLE_BLOCK_MAX: z.string().default('262144').transform(Number).pipe(z.number().int().min(1024).max(1048576)),
    IPFS_RECHECK_HOURS: z.string().default('24').transform(Number).pipe(z.number().int().min(1).max(720)),
    // Fail boot (instead of warning) on deprecated, reserved or unknown
    // prefixed variables (#243).
    CONFIG_STRICT: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
    REDIS_URL: z.string().default('redis://localhost:6379'),

    // ── HTTP ──────────────────────────────────────────────────────────────
    // Comma-separated origins allowed to call the API with credentials.
    CORS_ORIGINS: commaList(z.string().url(), 'http://localhost:3000'),

    // ── Auth ──────────────────────────────────────────────────────────────
    // Signs JWTs. Required in production; an ephemeral one is generated in
    // development/test so a fresh .env boots (sessions then end on restart).
    JWT_SECRET: optionalString,
    // Server key that signs SEP-10 challenge transactions. Not a funded
    // account and never the agent key. Same ephemeral fallback as above.
    AUTH_SIGNING_SECRET: optionalString,
    // Ed25519 key that signs trace-entitlement tokens (#62). Dedicated: never
    // JWT_SECRET, AUTH_SIGNING_SECRET or a wallet key. Format documented in
    // docs/contract-requests.md; a missing key in production stops boot.
    ENTITLEMENT_SIGNING_KEY: optionalString,
    // Dedicated Ed25519 key for signing purchase receipts (#313); never reused.
    RECEIPT_SIGNING_KEY: optionalString,
    RECEIPT_PREVIOUS_PUBLIC_KEYS: commaList(z.string()),
    DAILY_PASS_PRICE_VERSION: z.string().default('v1'),
    // Dedicated Ed25519 key for signing SEP-7 URI requests (#270); never reused.
    URI_REQUEST_SIGNING_SECRET: optionalString,
    // Dedicated Ed25519 key for signing reasoning traces (#273); never reused.
    TRACE_SIGNING_KEY: optionalString,
    TRACE_SIGNING_PREVIOUS_KEYS: commaList(
      z.string().regex(/^[0-9a-f]{64}$/i, 'must be a 64-char hex Ed25519 public key'),
      '',
    ),
    TRACE_SIGNING_REQUIRED: boolDefault('false'),
    SEP7_ORIGIN_DOMAIN: optionalString,
    SEP7_CALLBACK_BASE_URL: optionalString,
    SEP7_TOKEN_TTL_SECONDS: z.string().default('3600').transform(Number)
      .pipe(z.number().int().min(30).max(86400)),
    AUTH_HOME_DOMAIN: z.string().default('localhost'),
    AUTH_WEB_AUTH_DOMAIN: optionalString,
    // Public keys of previous server signing keys that may still verify
    // challenges they issued (#48). Format: G…[@ISO-8601-retirement].
    AUTH_PREVIOUS_SIGNING_KEYS: previousSigningKeys,
    // G… addresses seeded as super admins on first deploy. After the RBAC
    // tables exist the database is authoritative; this list is not consulted
    // for per-request authorization.
    ADMIN_ADDRESSES: commaList(stellarAccount),
    // Sensitive admin actions require a wallet proof no older than this (#49).
    STEP_UP_MAX_AGE_SECONDS: z.string().default('300').transform(Number)
      .pipe(z.number().int().min(30).max(3600)),

    // ── Challenge issuance hardening (#50) ───────────────────────────────
    AUTH_MAX_OUTSTANDING_PER_ADDRESS: z.string().default('5').transform(Number)
      .pipe(z.number().int().min(1).max(1000)),
    AUTH_MAX_OUTSTANDING_PER_IP: z.string().default('30').transform(Number)
      .pipe(z.number().int().min(1).max(100000)),
    AUTH_POW_THRESHOLD_PER_MIN: z.string().default('600').transform(Number)
      .pipe(z.number().int().min(0)),
    AUTH_POW_BITS: z.string().default('18').transform(Number)
      .pipe(z.number().int().min(1).max(32)),
    AUTH_POW_TTL_SECONDS: z.string().default('60').transform(Number)
      .pipe(z.number().int().min(10).max(600)),
    AUTH_CHALLENGE_TTL_SECONDS: z.string().default('300').transform(Number)
      .pipe(z.number().int().min(30).max(3600)),
    // Salt mixed into the SHA-256 of client IPs before they reach Redis.
    AUTH_IP_HASH_SALT: optionalString,
    // Express `trust proxy`; a comma list of hops or addresses, or "true".
    TRUST_PROXY: optionalString,
    // ── Premium session device cap (#288) ────────────────────────────────
    PREMIUM_MAX_DEVICES: z.string().default('2').transform(Number)
      .pipe(z.number().int().min(1).max(20)),
    PREMIUM_DAILY_READ_LIMIT: z.string().default('200').transform(Number)
      .pipe(z.number().int().min(1)),
    PREMIUM_DAILY_KEY_RELEASE_LIMIT: z.string().default('50').transform(Number)
      .pipe(z.number().int().min(1)),
    // HyperLogLog distinct-IP-prefix threshold for anomaly alerts.
    PREMIUM_ANOMALY_IP_THRESHOLD: z.string().default('5').transform(Number)
      .pipe(z.number().int().min(1)),
    REDIS_COMMAND_TIMEOUT_MS: z.string().default('500').transform(Number)
      .pipe(z.number().int().min(50).max(30000)),
    REDIS_CONNECT_TIMEOUT_MS: z.string().default('2000').transform(Number)
      .pipe(z.number().int().min(100).max(60000)),

    // ── SEP-45 contract-account auth (#47) ───────────────────────────────
    SEP45_ENABLED: boolDefault('false'),
    WEB_AUTH_CONTRACT_ID: optionalContract,
    SEP45_RPC_URL: optionalString,

    // ── Secrets (#145) ────────────────────────────────────────────────────
    // env: process environment (default); file: <NAME>_FILE mounts; vault:
    // Vault KV v2, refreshed every SECRETS_REFRESH_MS.
    SECRETS_PROVIDER: z.enum(['env', 'file', 'vault']).default('env'),
    SECRETS_REFRESH_MS: z
      .string()
      .default('300000')
      .transform(Number)
      .refine((v) => Number.isFinite(v) && v >= 30000, 'must be at least 30000 ms'),
    JWT_PREVIOUS_SECRET_GRACE_SECS: z
      .string()
      .default('86400')
      .transform(Number)
      .refine((v) => Number.isFinite(v) && v >= 0, 'must be a non-negative integer'),
    VAULT_ADDR: optionalString,
    VAULT_TOKEN_FILE: optionalString,
    VAULT_KV_PATH: optionalString,

    // ── Stellar ───────────────────────────────────────────────────────────
    STELLAR_RPC_URL: z.string().url().default('https://soroban-testnet.stellar.org'),
    STELLAR_NETWORK_PASSPHRASE: z.string().default(Networks.TESTNET),
    MARKET_CORE_CONTRACT_ID: optionalContract,
    TREASURY_CONTRACT_ID: optionalContract,
    RESOLVER_CONTRACT_ID: optionalContract,
    REASONING_REGISTRY_CONTRACT_ID: optionalContract,
    USDC_CONTRACT_ID: optionalContract,
    // Where premium payments must be sent. Defaults to the treasury contract
    // (see docs/api.md: that makes subscription revenue trading capital).
    PAYMENTS_RECIPIENT: optionalAddress,
    DAILY_PASS_PRICE_RAW: z.string().regex(/^\d+$/, 'must be an integer in 7-decimal base units').default('5000000'),
    // #224 phase B: false stops writing the Float display mirrors on payments,
    // subscriptions and allowances (DB defaults of 0 apply). Removed together
    // with the columns by the pending contract migration.
    PAYMENT_FLOAT_WRITES: boolDefault('true'),

    // ── x402 daily pass (#61) ─────────────────────────────────────────────
    // The facilitator that verifies and settles x402 payments on Stellar.
    // Required to boot when X402_ENABLED=true; empty disables the endpoint.
    X402_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
    X402_FACILITATOR_URL: optionalString,
    // CAIP-2 network id, e.g. stellar:testnet.
    X402_NETWORK: z.string().default('stellar:testnet'),
    // Seconds the x402 middleware may take talking to the facilitator.
    X402_FACILITATOR_TIMEOUT_MS: z.string().default('15000').transform(Number)
      .pipe(z.number().int().min(1000)),

    // ── Trace entitlement tokens (#62) ────────────────────────────────────
    // Audience the x402 service must expect; also the `aud` claim.
    X402_ENTITLEMENT_AUDIENCE: z.string().default('oracledesk-x402'),
    // Minutes; never longer than the remaining pass time.
    ENTITLEMENT_TOKEN_TTL_SECONDS: z.string().default('300').transform(Number)
      .pipe(z.number().int().min(30).max(3600)),
    // Comma-separated public keys (`ed25519-public:<base64 SPKI>`) accepted
    // during rotation, in addition to the current signing key.
    ENTITLEMENT_PREVIOUS_PUBLIC_KEYS: commaList(z.string()),

    // ── x402 trace price discovery (#63) ──────────────────────────────────
    // The authoritative x402 service URL. Empty disables discovery (reported as unknown).
    X402_SERVICE_URL: optionalString,
    // Request timeout for price discovery queries.
    X402_DISCOVERY_TIMEOUT_MS: z.string().default('5000').transform(Number)
      .pipe(z.number().int().min(100)),
    // In-memory cache TTL for validated payment requirements.
    X402_PRICE_CACHE_TTL_MS: z.string().default('60000').transform(Number)
      .pipe(z.number().int().min(1000)),

    // ── x402 allowance reservations (#219) ────────────────────────────────
    // Shared HMAC-SHA256 secret the x402 trace service signs
    // /x402/allowance/* requests with. Empty disables those endpoints (503).
    // Dedicated: never X402_KEY_RELEASE_SECRET or another key.
    X402_ALLOWANCE_HMAC_SECRET: optionalString.refine(
      (v) => v === '' || v.length >= 32,
      'must be at least 32 characters',
    ),
    // How long a RESERVED charge holds budget before the sweep expires it.
    X402_ALLOWANCE_RESERVATION_TTL_SECONDS: z.string().default('120').transform(Number)
      .pipe(z.number().int().min(10).max(3600)),
    // ── Server-issued payment intents (#52) ──────────────────────────────
    // How long a client may take to submit a transaction for an open intent.
    PAYMENT_INTENT_TTL_SECONDS: z.string().default('900').transform(Number)
      .pipe(z.number().int().min(60).max(86_400)),
    // Bounded open/pending intents per user; prevents intent-table spam.
    PAYMENT_INTENT_MAX_OPEN: z.string().default('3').transform(Number)
      .pipe(z.number().int().min(1).max(100)),
    PAYMENT_INTENT_CONFIRM_ENABLED: boolDefault('true'),
    // Six-field cron (seconds field). Each tick is bounded by the batch size.
    PAYMENT_INTENT_CONFIRM_CRON: z.string().default('*/20 * * * * *'),
    PAYMENT_INTENT_CONFIRM_BATCH: z.string().default('20').transform(Number)
      .pipe(z.number().int().min(1).max(500)),
    PAYMENT_INTENT_MAX_ATTEMPTS: z.string().default('60').transform(Number)
      .pipe(z.number().int().min(1).max(10_000)),
    PAYMENT_INTENT_RETRY_BASE_MS: z.string().default('5000').transform(Number)
      .pipe(z.number().int().min(1000).max(3_600_000)),
    PAYMENT_INTENT_RETRY_MAX_MS: z.string().default('300000').transform(Number)
      .pipe(z.number().int().min(1000).max(86_400_000)),
    // Extra time after expiresAt before a still-pending tx is abandoned.
    PAYMENT_INTENT_LATE_GRACE_SECONDS: z.string().default('120').transform(Number)
      .pipe(z.number().int().min(0).max(86_400)),

    // ── Refund workflow (#57) ─────────────────────────────────────────────
    // How long a prepared refund XDR stays valid before it must be rebuilt.
    REFUND_PREPARE_TTL_SECONDS: z.string().default('600').transform(Number)
      .pipe(z.number().int().min(60).max(86_400)),

    // dry-run: every write is built and simulated, never signed or sent.
    // live: writes are signed with AGENT_SECRET_KEY and submitted (testnet only).
    CHAIN_EXECUTION_MODE: z.enum(['dry-run', 'live']).default('dry-run'),
    AGENT_SECRET_KEY: optionalString,

    // ── Source-account sequencing (#36) ───────────────────────────────────
    // Live writes take a fenced per-account lock in Redis before allocating a
    // sequence number. The TTL must cover simulate + sign + sendTransaction.
    SEQ_LOCK_TTL_MS: z.string().default('45000').transform(Number).pipe(z.number().int().min(1000)),
    SEQ_LOCK_HEARTBEAT_MS: z.string().default('15000').transform(Number).pipe(z.number().int().min(1000)),
    SEQ_LOCK_WAIT_MS: z.string().default('120000').transform(Number).pipe(z.number().int().min(0)),

    // ── Write retry policy (#40) ──────────────────────────────────────────
    // Live writes are retried only for classes that are provably not applied.
    // The deadline caps total time; attempts caps rebuilds.
    CHAIN_RETRY_MAX_ATTEMPTS: z.string().default('3').transform(Number).pipe(z.number().int().min(1)),
    CHAIN_RETRY_BASE_MS: z.string().default('250').transform(Number).pipe(z.number().int().min(1)),
    CHAIN_RETRY_MAX_MS: z.string().default('5000').transform(Number).pipe(z.number().int().min(1)),
    CHAIN_RETRY_DEADLINE_MS: z.string().default('30000').transform(Number).pipe(z.number().int().min(1)),

    // ── Fee bump sponsorship (#38) ────────────────────────────────────────
    // When an outbox row stays pending past FEE_BUMP_AFTER_LEDGERS, its stored
    // inner envelope is wrapped in a fee bump paid by FEE_PAYER_SECRET. The
    // inclusion fee starts at the previous value × FEE_BUMP_MULTIPLIER (or the
    // p90 surge price) and is capped by FEE_BUMP_MAX_STROOPS.
    FEE_PAYER_SECRET: optionalString,
    FEE_BUMP_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
    FEE_BUMP_AFTER_LEDGERS: z.string().default('3').transform(Number).pipe(z.number().int().min(1)),
    FEE_BUMP_MULTIPLIER: z.string().default('2').transform(Number).pipe(z.number().min(1)),
    FEE_BUMP_MAX_STROOPS: z.string().default('10000000').transform(Number).pipe(z.number().int().min(1)),
    FEE_BUMP_MAX_ATTEMPTS: z.string().default('3').transform(Number).pipe(z.number().int().min(1)),

    // Resolution spec committed at market creation (ADR 0001). Signer mode:
    // RESOLUTION_SIGNERS attest the outcome on the resolver contract. Empty
    // means the agent account is the only signer.
    RESOLUTION_SIGNERS: commaList(stellarAccount),
    RESOLUTION_THRESHOLD: z.string().default('1').transform(Number),
    RESOLUTION_DISPUTE_WINDOW_SECS: z.string().default('86400').transform(Number),

    // ── Evidence-backed attestation (#88) ─────────────────────────────────
    RESOLUTION_ATTESTATION_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
    RESOLUTION_AUTO_APPROVE_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
    RESOLUTION_AUTO_APPROVE_MIN_CONFIDENCE: z.string().default('0.90').transform(Number).pipe(z.number().min(0).max(1)),
    RESOLUTION_HIGH_VALUE_THRESHOLD_USDC: z.string().default('10000').transform(Number).pipe(z.number().positive()),
    RESOLUTION_ATTESTATION_POLL_MS: z.string().default('300000').transform(Number).pipe(z.number().int().min(1000)),

    // ── Permissionless finalization keeper (#89) ──────────────────────────
    KEEPER_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
    KEEPER_POLL_MS: z.string().default('60000').transform(Number).pipe(z.number().int().min(1000)),
    KEEPER_BATCH_SIZE: z.string().default('10').transform(Number).pipe(z.number().int().min(1).max(100)),
    KEEPER_MAX_RETRIES: z.string().default('3').transform(Number).pipe(z.number().int().min(1)),

    // ── Resumable SSE event stream (#95) ──────────────────────────────────
    SSE_HEARTBEAT_INTERVAL_MS: z.string().default('15000').transform(Number).pipe(z.number().int().min(1000)),
    SSE_POLL_INTERVAL_MS: z.string().default('2000').transform(Number).pipe(z.number().int().min(500)),
    SSE_MAX_CONCURRENT_STREAMS: z.string().default('500').transform(Number).pipe(z.number().int().min(1)),
    SSE_REPLAY_PAGE_SIZE: z.string().default('100').transform(Number).pipe(z.number().int().min(1).max(500)),

    // ── Price-mode markets (#90) ──────────────────────────────────────────
    // Cited Reflector (SEP-40) feeds; see src/config/reflector-feeds.ts.
    REFLECTOR_FEEDS_JSON: reflectorFeeds,
    // How long resolve_price keeps retrying PriceUnavailable/StalePrice before
    // escalating with an ERROR AgentLog for a guardian to void the market.
    PRICE_RESOLUTION_MAX_WAIT_SECS: z.string().default('86400').transform(Number).pipe(z.number().int().min(60)),
    PRICE_RESOLUTION_POLL_MS: z.string().default('300000').transform(Number).pipe(z.number().int().min(1000)),
    // Reflector feed monitor & post-resolution verifier (#309)
    PRICE_FEED_MONITOR_CLOSE_WINDOW_SECS: z.string().default('7200').transform(Number).pipe(z.number().int().min(60)),
    PRICE_FEED_GAP_SLOTS: z.string().default('6').transform(Number).pipe(z.number().int().min(1).max(100)),
    PRICE_VERIFY_OUTLIER_BPS: z.string().default('500').transform(Number).pipe(z.number().int().min(1).max(100_000)),

    // Failure breaker (#79): this many chain-write failures inside the window
    // pause the writing agent until an operator resumes it.
    AGENT_FAILURE_THRESHOLD: z.string().default('5').transform(Number),
    AGENT_FAILURE_WINDOW_MS: z.string().default('1800000').transform(Number),

    // ── Fee policies (#39) ───────────────────────────────────────────────
    FEE_POLICY_JSON: optionalString,
    FEE_STATS_CACHE_MS: z.string().default('10000').transform(Number).pipe(z.number().int().positive()),
    FEE_STATS_MAX_AGE_MS: z.string().default('60000').transform(Number).pipe(z.number().int().positive()),

    // ── Timebounds & Rebuilds (#42) ───────────────────────────────────────
    TIMEOUT_MARKET_CREATE_SECONDS: z.string().default('60').transform(Number).pipe(z.number().int().min(15).max(300)),
    TIMEOUT_TRADE_SECONDS: z.string().default('30').transform(Number).pipe(z.number().int().min(10).max(120)),
    // #245: seconds after the decision ledger's close time that an agent trade
    // may still execute (the on-chain deadline for the v2 entrypoints).
    TRADE_DECISION_TTL_SECONDS: z.string().default('60').transform(Number).pipe(z.number().int().min(1).max(300)),
    TIMEOUT_TRACE_PUBLISH_SECONDS: z.string().default('45').transform(Number).pipe(z.number().int().min(10).max(180)),
    TIMEOUT_MAINTENANCE_SECONDS: z.string().default('30').transform(Number).pipe(z.number().int().min(10).max(120)),
    AUTH_EXPIRY_MARGIN_LEDGERS: z.string().default('12').transform(Number).pipe(z.number().int().min(2).max(100)),
    MAX_REBUILD_COUNT: z.string().default('2').transform(Number).pipe(z.number().int().min(0).max(10)),

    // ── Channel Accounts (#37) ────────────────────────────────────────────
    CHANNEL_SECRET_KEYS: optionalString,
    CHANNELS_SECRETS_FILE: optionalString,
    CHANNEL_MIN_BALANCE_XLM: z.string().default('5').transform(Number).pipe(z.number().positive()),
    CHANNEL_ACQUIRE_TIMEOUT_MS: z.string().default('5000').transform(Number).pipe(z.number().int().positive()),
    CHANNEL_LEASE_MS: z.string().default('60000').transform(Number).pipe(z.number().int().positive()),

    // ── Event bus and socket fan-out (#93) ────────────────────────────────
    // Redis Streams bus between the indexer and the socket fan-out. When
    // false, events go through an in-process bus (single instance only).
    EVENT_BUS_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
    // Approximate stream cap (XADD MAXLEN ~). chain_events stays the durable history.
    EVENT_BUS_MAXLEN: z.string().default('100000').transform(Number)
      .pipe(z.number().int().min(1000)),
    // One XREAD batch and its BLOCK duration. The blocking connection disables
    // ioredis commandTimeout (a 500 ms timeout rejects every idle BLOCK 1000
    // read); EVENT_BUS_BLOCKING_TIMEOUT_MS is the safety net above the block.
    EVENT_BUS_READ_COUNT: z.string().default('100').transform(Number)
      .pipe(z.number().int().min(1).max(1000)),
    EVENT_BUS_BLOCK_MS: z.string().default('1000').transform(Number)
      .pipe(z.number().int().min(100).max(30000)),
    EVENT_BUS_BLOCKING_TIMEOUT_MS: z.string().default('5000').transform(Number)
      .pipe(z.number().int().min(200).max(60000)),
    // Identifies this process as fan-out leader candidate and in logs.
    INSTANCE_ID: z.string().default('').transform((v) => v.trim() || `${os.hostname()}-${process.pid}`),

    // ── Dispute monitor (#92) ─────────────────────────────────────────────
    DISPUTE_MONITOR_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
    // Independent confidence needed for an AGREE or DISAGREE verdict.
    DISPUTE_AGREE_MIN_CONFIDENCE: z.string().default('0.8').transform(Number)
      .pipe(z.number().gt(0).max(1)),
    // Markets holding at least this much liquidity (USDC) need a cited primary
    // (non-news) source before the review may say AGREE.
    DISPUTE_HIGH_VALUE_LIQUIDITY: z.string().default('10000').transform(Number)
      .pipe(z.number().nonnegative()),
    // Evaluator calibration (#247)
    // Maximum acceptable one-sided Clopper–Pearson upper bound on the false-silence
    // rate for a slice to be eligible for threshold enforcement.
    DISPUTE_TARGET_FALSE_SILENCE_RATE: z.string().default('0.02').transform(Number)
      .pipe(z.number().gt(0.001).max(0.2)),
    // Minimum number of AGREE reviews above a candidate threshold before that
    // threshold qualifies. With 0 errors, 150 reviews are needed for a 2% target.
    DISPUTE_CALIBRATION_MIN_N: z.string().default('30').transform(Number)
      .pipe(z.number().int().min(1)),
    // 'off' = ignore calibration entirely.
    // 'observe' = log shadow decisions but keep existing behaviour (default).
    // 'enforce' = apply calibrated threshold; AGREE becomes INSUFFICIENT for
    //             uncalibrated slices.
    DISPUTE_CALIBRATED_THRESHOLD: z.enum(['off', 'observe', 'enforce']).default('observe'),
    // The resolver admin (guardian). The resolver has no admin view, so this
    // is configuration; cancel_proposal / guardian_void_market are simulated as it.
    RESOLVER_GUARDIAN_ADDRESS: optionalAddress,
    // Comma-separated generic JSON webhooks and one Slack-compatible webhook.
    // The URLs usually embed tokens: never logged.
    ALERT_WEBHOOK_URLS: commaList(z.string().url()),
    ALERT_SLACK_WEBHOOK_URL: optionalString.refine((v) => v === '' || URL.canParse(v), 'must be a URL'),
    // HMAC-SHA256 key for the X-OracleDesk-Signature header on generic webhooks.
    ALERT_WEBHOOK_SECRET: optionalString,

    // ── Operational alerts (#226) ─────────────────────────────────────────
    // Evaluation schedule (one leader per tick via an advisory lock).
    ALERT_EVAL_CRON: z.string().default('* * * * *'),
    // Hysteresis: open after N consecutive bad evaluations, resolve after M good.
    ALERT_OPEN_AFTER: z.string().default('2').transform(Number).pipe(z.number().int().min(1).max(100)),
    ALERT_RESOLVE_AFTER: z.string().default('3').transform(Number).pipe(z.number().int().min(1).max(100)),
    // Unacknowledged CRITICAL incidents re-notify this often.
    ALERT_ESCALATE_EVERY_MS: z.string().default(String(30 * 60_000)).transform(Number).pipe(z.number().int().min(60_000)),
    // At most one open notification per subject per this period.
    ALERT_MIN_REOPEN_MS: z.string().default(String(10 * 60_000)).transform(Number).pipe(z.number().int().min(0)),
    // Outbox rows in SUBMITTED/PENDING older than this are WARN (past maxTime is CRITICAL).
    ALERT_OUTBOX_STUCK_MS: z.string().default(String(15 * 60_000)).transform(Number).pipe(z.number().int().min(60_000)),
    // Terminal outbox rows whose completion handler has not run after this long.
    ALERT_UNHANDLED_MS: z.string().default(String(10 * 60_000)).transform(Number).pipe(z.number().int().min(60_000)),
    // Consecutive failed runs of one cron job before it alerts.
    ALERT_CRON_FAILURE_STREAK: z.string().default('3').transform(Number).pipe(z.number().int().min(1)),
    // Operator pauses are INFO and not alerted unless enabled.
    ALERT_OPERATOR_PAUSES: boolDefault('false'),
    // Severity → sink names, e.g. {"CRITICAL":["webhook:0","slack"],"WARN":["slack"]}.
    // Empty = every sink for WARN and CRITICAL, none for INFO.
    ALERT_ROUTES_JSON: optionalString.refine((v) => {
      if (v === '') return true;
      try {
        const parsed = JSON.parse(v);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) &&
          Object.entries(parsed).every(([k, list]) => ['INFO', 'WARN', 'CRITICAL'].includes(k) &&
            Array.isArray(list) && list.every((n) => typeof n === 'string'));
      } catch {
        return false;
      }
    }, 'must be a JSON object of INFO|WARN|CRITICAL → sink-name arrays'),

    // ── Transaction outbox (#35) ──────────────────────────────────────────
    // Recovery worker interval; it resolves non-terminal chain_transactions.
    OUTBOX_POLL_MS: z.string().default('5000').transform(Number)
      .pipe(z.number().int().min(250)),
    // How long a live write waits inline for confirmation before returning
    // CHAIN_PENDING and leaving resolution to the worker.
    OUTBOX_INLINE_WAIT_MS: z.string().default('30000').transform(Number)
      .pipe(z.number().int().min(1000)),

    // Spec compatibility gate (#34). Empty derives from the execution mode:
    // live → enforce (refuse to start on breaking spec/wasm drift), dry-run →
    // warn (log and keep running). off skips the check entirely.
    SPEC_COMPAT_ENFORCE: z
      .string()
      .default('')
      .refine((v) => ['', 'off', 'warn', 'enforce'].includes(v), 'must be off, warn or enforce'),
    // Runtime spec-compat monitor (#322): periodic interval, debounce gap for
    // signal-triggered checks, and consecutive unverifiable runs before pause.
    SPEC_COMPAT_INTERVAL_MS: z.string().default('600000').transform(Number).pipe(z.number().int().min(1000)),
    SPEC_COMPAT_MIN_GAP_MS: z.string().default('60000').transform(Number).pipe(z.number().int().min(100)),
    SPEC_COMPAT_UNVERIFIABLE_RUNS: z.string().default('3').transform(Number).pipe(z.number().int().min(1)),

    TRUST_INBOUND_REQUEST_ID: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
    INDEXER_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
    INDEXER_POLL_MS: z.string().default('5000').transform(Number),


    // ── Health probes (#111) ──────────────────────────────────────────────
    // Dependencies that make /readyz fail. RPC is non-critical by default so
    // cached DB reads can still be served while chain reads return 502.
    HEALTH_CRITICAL: commaList(probeName, 'database,redis'),
    HEALTH_PROBE_TIMEOUT_MS: z.string().default('1500').transform(Number),
    HEALTH_CACHE_TTL_MS: z.string().default('2000').transform(Number),
    INDEXER_MAX_LAG_LEDGERS: z.string().default('120').transform(Number),
    INDEXER_MAX_STALENESS_MS: z.string().default('60000').transform(Number),
    LIVENESS_MAX_LOOP_DELAY_MS: z.string().default('2000').transform(Number),
    // Chain-write readiness (#220). auto = live mode && this process runs the
    // outbox worker (PROCESS_ROLE all|worker); true/false force it. On a
    // non-writer the outbox/signers/channels probes are no-ops and never critical.
    HEALTH_CHAIN_WRITER: z.enum(['auto', 'true', 'false']).default('auto'),
    HEALTH_OUTBOX_MAX_INFLIGHT: z.string().default('50').transform(Number).pipe(z.number().int().min(1)),
    HEALTH_OUTBOX_MAX_AGE_MS: z.string().default('300000').transform(Number).pipe(z.number().int().min(1)),
    HEALTH_HANDLER_MAX_STREAK: z.string().default('5').transform(Number).pipe(z.number().int().min(1)),
    HEALTH_BALANCE_MIN_RUNWAY_HOURS: z.string().default('24').transform(Number).pipe(z.number().min(0)),
    HEALTH_BALANCE_TTL_MS: z.string().default('60000').transform(Number).pipe(z.number().int().min(0)),
    // Time /readyz reports "draining" before the HTTP server stops accepting.
    SHUTDOWN_DRAIN_MS: z.string().default('5000').transform(Number),

    // ── Cron run history retention (#336) ─────────────────────────────────
    CRON_RUNS_RETENTION_DAYS: z.string().default('14').transform(Number).pipe(z.number().int().min(1)),

    // ── Semantic dedup (#69) ──────────────────────────────────────────────
    // none keeps the lexical check. The vector column is vector(768): the
    // dimension must match the migration, and the provider rejects a mismatch.
    EMBEDDING_PROVIDER: z.enum(['none', 'gemini', 'openai']).default('none'),
    EMBEDDING_MODEL: optionalString,
    EMBEDDING_DIM: z.string().default('768').transform(Number).pipe(z.number().int().positive()),
    // Cosine similarity at which a nearest neighbour becomes a duplicate candidate.
    DEDUP_SIM_THRESHOLD: z.string().default('0.85').transform(Number).pipe(z.number().min(0).max(1)),
    // Two markets whose resolution dates are within this many days are "the same date".
    DEDUP_DATE_WINDOW_DAYS: z.string().default('3').transform(Number).pipe(z.number().min(0)),

    // ── Trader forecaster (#75) ───────────────────────────────────────────
    // LLM samples per forecast; with more than one the median p is used and
    // the spread is added to the variance.
    FORECAST_LLM_SAMPLES: z.string().default('1').transform(Number)
      .pipe(z.number().int().min(1).max(5)),
    // Shrink the ensemble's log-odds toward 0.5 by this factor.
    FORECAST_SHRINK: z.string().default('0.15').transform(Number)
      .pipe(z.number().min(0).max(0.9)),
    // Markets forecast (not served from cache) per trader cycle.
    FORECAST_MAX_MARKETS_PER_CYCLE: z.string().default('5').transform(Number)
      .pipe(z.number().int().min(0).max(100)),
    // Forecasting LLM calls per trader cycle (samples included).
    FORECAST_MAX_LLM_CALLS_PER_CYCLE: z.string().default('10').transform(Number)
      .pipe(z.number().int().min(0).max(500)),
    // A forecast is reused while the market and its relevant signals are unchanged.
    FORECAST_CACHE_TTL_HOURS: z.string().default('6').transform(Number)
      .pipe(z.number().positive().max(72)),

    // ── Calibration (#68) ─────────────────────────────────────────────────
    // Slices with fewer resolved markets report insufficientData instead of noise.
    MIN_CALIBRATION_MARKETS: z.string().default('20').transform(Number)
      .pipe(z.number().int().min(1)),
    // How a market's weight is split between its traces: time | last | first.
    CALIBRATION_WEIGHTING: z.enum(['time', 'last', 'first']).default('time'),
    // Shrink the trader's probability toward 0.5 by the fitted calibration factor.
    CALIBRATION_SHRINKAGE_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
    // #244 recalibration: identity-prior strength (pseudo-markets) and the
    // largest log-odds intercept a fitted map may apply.
    RECALIBRATION_PRIOR_STRENGTH: z.string().default('20').transform(Number).pipe(z.number().positive()),
    RECALIBRATION_MAX_INTERCEPT: z.string().default('0.5').transform(Number).pipe(z.number().min(0).max(2)),
    // #223 learned source weights: a key fitted on fewer effective samples keeps its parent weight.
    WEIGHTS_MIN_NEFF: z.string().default('30').transform(Number).pipe(z.number().positive()),

    // Build commit, recorded in trace provenance (#66). Set by CI/deploy.
    GIT_SHA: optionalString,

    // ── LLM providers (optional; generation fails at runtime without one) ─
    ANTHROPIC_API_KEY: optionalString,
    GEMINI_API_KEY: optionalString,
    // OpenAI or any OpenAI-compatible endpoint (used by the router, #157).
    OPENAI_API_KEY: optionalString,
    OPENAI_BASE_URL: optionalString.refine(
      (v) => v === '' || /^https?:\/\//.test(v),
      'must be an http(s) URL',
    ),
    // JSON object keyed by LlmTask, or a path to a JSON file. Defaults to the
    // built-in policy that reproduces the pre-router behaviour.
    LLM_POLICY: optionalString,
    LLM_POLICY_FILE: optionalString,

    // ── LLM budgets and shared guards (#71) ───────────────────────────────
    // Counted per UTC day across all providers and instances (see
    // src/lib/llm-budget.ts). Costs are estimates from a static price table.
    LLM_DAILY_TOKEN_BUDGET: z.string().default('2000000').transform(Number)
      .pipe(z.number().int().positive()),
    LLM_DAILY_COST_BUDGET_MICROS: z.string().default('20000000').transform(Number)
      .pipe(z.number().int().positive()),
    // Share of the budgets held back for admin-triggered work (deprecated in
    // favour of LLM_CLASS_POLICY; maps onto admin.guaranteePct, #327).
    LLM_ADMIN_RESERVE_PCT: z.string().default('10').transform(Number)
      .pipe(z.number().min(0).max(100)),
    // Per-purpose class budget policy JSON (#327): guarantees must sum to <= 100.
    LLM_CLASS_POLICY: z
      .string()
      .default('')
      .refine((v) => {
        if (!v.trim()) return true;
        try {
          return llmClassPolicySchema.safeParse(JSON.parse(v)).success;
        } catch {
          return false;
        }
      }, 'must be valid JSON matching ClassPolicy per class with sum(guaranteePct) <= 100'),
    // Max wait for a time-critical dispute review when rate-limited (#327, default 10 min).
    LLM_DISPUTE_MAX_WAIT_MS: z.string().default('600000').transform(Number)
      .pipe(z.number().int().positive()),
    LLM_ANTHROPIC_RPM: z.string().default('12').transform(Number)
      .pipe(z.number().int().positive()),
    LLM_GEMINI_RPM: z.string().default('15').transform(Number)
      .pipe(z.number().int().positive()),
    // OpenAI-compatible calls, router and structured (#218).
    LLM_OPENAI_RPM: z.string().default('15').transform(Number)
      .pipe(z.number().int().positive()),
    LLM_BREAKER_FAILURE_THRESHOLD: z.string().default('3').transform(Number)
      .pipe(z.number().int().positive()),
    LLM_BREAKER_OPEN_MS: z.string().default('3600000').transform(Number)
      .pipe(z.number().int().positive()),
    // What to do when the guard store (Redis) is unreachable: refuse LLM calls
    // (closed, recommended in production) or use a per-process limiter (open).
    LLM_REDIS_FAIL_MODE: z.enum(['closed', 'open']).default('closed'),

    // ── IPFS ──────────────────────────────────────────────────────────────
    PINATA_API_KEY: optionalString,
    PINATA_SECRET_API_KEY: optionalString,
    IPFS_GATEWAY_URL: z.string().url().default('https://gateway.pinata.cloud/ipfs'),
    // Local verified content store (#100). Both are byte caps.
    IPFS_CACHE_MAX_OBJECT_BYTES: z.string().default('262144').transform(Number)
      .pipe(z.number().int().positive()),
    IPFS_CACHE_BUDGET_BYTES: z.string().default('268435456').transform(Number)
      .pipe(z.number().int().positive()),

    // ── Transparency reports (#159) ───────────────────────────────────────
    REPORTS_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
    REPORT_CRON: z.string().default('10 0 * * *'),
    REPORT_MODE: z.enum(['dry-run', 'live']).default('dry-run'),
    // Tolerance in 7-decimal base units before a NAV reconciliation diff forces best_effort (#299).
    REPORT_NAV_TOLERANCE_RAW: z.string().regex(/^\d+$/, 'must be a non-negative integer').default('0'),
    // On-chain treasury accounting cache TTL and max ledger skew across parallel views (#299).
    ACCOUNTING_CACHE_MS: z.string().default('15000').transform(Number).pipe(z.number().int().min(100)),
    ACCOUNTING_MAX_LEDGER_SKEW: z.string().default('1').transform(Number).pipe(z.number().int().min(0)),

    // ── Treasury admin console (#156) ─────────────────────────────────────
    // Lifetime of a prepared unsigned transaction.
    TREASURY_OP_TTL_SECONDS: z.string().default('3600').transform(Number)
      .pipe(z.number().int().positive()),
    // Optional stricter backend policy for withdraw operations.
    TREASURY_WITHDRAW_MIN_SIGNERS: z.string().default('0').transform(Number)
      .pipe(z.number().int().min(0).max(20)),
    // ── Treasury-aware sizing (#76) ───────────────────────────────────────
    // Share of the daily and per-market headroom the trader leaves unused
    // (basis points): the daily window can roll and other writers (market
    // creation) share the caps between the budget read and the submit.
    TREASURY_HEADROOM_SAFETY_BPS: z.string().default('500').transform(Number)
      .pipe(z.number().int().min(0).max(9_999)),
    // #266 — fresh-price gating for the trader.
    /** Indexer lag threshold (ledgers) before the trader prefers a live chain read. Default 12 ≈ 1 min. */
    TRADER_MAX_PRICE_LAG_LEDGERS: z.string().default('12').transform(Number).pipe(z.number().int().min(1)),
    /** Max price drift (bps) between decision and execution quote before refusing the order. */
    TRADER_MAX_PRICE_DRIFT_BPS: z.string().default('150').transform(Number).pipe(z.number().int().min(0)),
    /** Consecutive stale-price markets that abort the scan cycle with PRICE_SOURCE_DOWN. */
    TRADER_STALE_ABORT_COUNT: z.string().default('3').transform(Number).pipe(z.number().int().min(1)),
    // ── Market-core TWAP and breakers (#292) ──────────────────────────────
    /** Window for the manipulation-resistant YES-price TWAP used by risk decisions. */
    TWAP_WINDOW_SECS: z.string().default('300').transform(Number).pipe(z.number().int().min(30).max(3600)),
    /** Minimum observations required before a TWAP replaces the spot mark for risk. */
    TWAP_MIN_OBSERVATIONS: z.string().default('2').transform(Number).pipe(z.number().int().min(1).max(16)),
    /** Spot/TWAP divergence (bps) above which a spot-only stop is deferred. */
    TWAP_DIVERGENCE_BPS: z.string().default('500').transform(Number).pipe(z.number().int().min(0).max(5000)),
    /** Max parts a breaker-limited exit is split into across ledger cycles. */
    EXIT_BREAKER_MAX_PARTS: z.string().default('4').transform(Number).pipe(z.number().int().min(1).max(20)),
    /** #225 — max ledgers the reserves the trader sizes against may lag the RPC (valuation DEFAULT_MAX_AGE_LEDGERS). */
    TRADER_POOL_MAX_AGE_LEDGERS: z.string().default('120').transform(Number).pipe(z.number().int().min(1)),
    // #147 — development-only local IPFS stub selected explicitly.
    IPFS_TRANSPORT: z.enum(['pinata', 'local']).default('pinata'),
    IPFS_LOCAL_DIR: z.string().default('.ipfs-local'),

    // ── Public API Base URL & Schema ──────────────────────────────────────
    PUBLIC_API_BASE_URL: z.string().url().default('http://localhost:8000'),
    QUESTION_DOC_VERSION: z.string().default('2').transform(Number),

    // ── Confidential Traces ──────────────────────────────────────────────
    TRACE_CONFIDENTIAL: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
    TRACE_KEKS: optionalString,
    TRACE_KEK_ACTIVE: z.string().default('kek-2026-10'),
    X402_KEY_RELEASE_SECRET: optionalString,

    // ── Saga ─────────────────────────────────────────────────────────────
    SAGA_RECOVERY_SCAN: z.string().default('50').transform(Number),
    SAGA_MAX_ATTEMPTS: z.string().default('8').transform(Number),

    // ── Data sources ──────────────────────────────────────────────────────
    NEWSAPI_KEY: optionalString,
    FRED_API_KEY: optionalString,
    // ── Signal store (#73) ────────────────────────────────────────────────
    // A source is re-fetched once its last successful fetch is older than this.
    SIGNAL_REFRESH_MINUTES: z.string().default('15').transform(Number)
      .pipe(z.number().int().min(1).max(24 * 60)),
    // Raw provider payloads are deleted after this many days.
    SIGNAL_RAW_RETENTION_DAYS: z.string().default('7').transform(Number)
      .pipe(z.number().int().min(1).max(365)),

    // ── Cross-source corroboration (#228) ─────────────────────────────────
    // off: no check. observe: log the verdict and continue. enforce: an
    // uncorroborated proposal creates nothing (no row, pin, seed or trace).
    CORROBORATION_MODE: z.enum(['off', 'observe', 'enforce']).default('observe'),
    // Independent units (clusters merged by domain and rewrite distance) needed.
    CORROBORATION_MIN_PUBLISHERS: z.string().default('2').transform(Number).pipe(z.number().int().min(1).max(20)),
    // Coverage must be published within this many hours before the cycle.
    CORROBORATION_WINDOW_HOURS: z.string().default('72').transform(Number).pipe(z.number().int().min(1).max(24 * 30)),
    // SimHash distance under which two clusters are one rewritten story.
    CORROBORATION_SIMHASH_REWRITE: z.string().default('10').transform(Number).pipe(z.number().int().min(0).max(64)),
    // Store rows considered per check, newest first.
    CORROBORATION_MAX_CANDIDATES: z.string().default('500').transform(Number).pipe(z.number().int().min(1).max(10_000)),
    // Live mode requires enforce unless this is set.
    CORROBORATION_ALLOW_OBSERVE_LIVE: boolDefault('false'),

    // ── Resilience & Timeouts ─────────────────────────────────────────────
    TIMEOUT_RPC_READ_MS: z.string().default('8000').transform(Number),
    TIMEOUT_RPC_WRITE_MS: z.string().default('45000').transform(Number),
    TIMEOUT_RPC_CONFIRM_MS: z.string().default('8000').transform(Number),
    TIMEOUT_RPC_EVENTS_MS: z.string().default('15000').transform(Number),
    TIMEOUT_LLM_MS: z.string().default('60000').transform(Number),
    TIMEOUT_IPFS_PIN_MS: z.string().default('20000').transform(Number),
    TIMEOUT_IPFS_FETCH_MS: z.string().default('15000').transform(Number),
    TIMEOUT_DATASOURCE_MS: z.string().default('10000').transform(Number),

    // Bulkheads (max concurrent)
    BULKHEAD_LLM: z.string().default('2').transform(Number),
    BULKHEAD_IPFS: z.string().default('4').transform(Number),
    BULKHEAD_RPC_READ: z.string().default('16').transform(Number),
    BULKHEAD_RPC_WRITE: z.string().default('4').transform(Number),
    BULKHEAD_RPC_CONFIRM: z.string().default('8').transform(Number),
    BULKHEAD_RPC_EVENTS: z.string().default('4').transform(Number),
    BULKHEAD_DATASOURCE: z.string().default('8').transform(Number),
    BULKHEAD_QUEUE: z.string().default('32').transform(Number),
    // Proactive shedding threshold for saturated RPC bulkheads (#300)
    RPC_SHED_AFTER_MS: z.string().default('2000').transform(Number).pipe(z.number().int().min(0)),
    // Optional JSON overrides for per-class bulkhead policies (#300)
    RPC_CLASS_POLICY_JSON: optionalString,

    // Request & cycle deadlines
    HTTP_REQUEST_TIMEOUT_MS: z.string().default('30000').transform(Number),
    CYCLE_DEADLINE_MS: z.string().default('600000').transform(Number),
    // Must exceed CYCLE_DEADLINE_MS so a live cycle never loses its lease.
    MARKET_RESERVATION_LEASE_MS: z.string().default('660000').transform(Number).pipe(
      z.number().refine((v) => v > 600000, { message: 'MARKET_RESERVATION_LEASE_MS must exceed CYCLE_DEADLINE_MS (600000)' }),
    ),
    IPFS_MAX_BYTES: z.string().default('2097152').transform(Number),

    // ── Trace Audit (Issue #150, #306) ────────────────────────────────────
    TRACE_AUDIT_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
    TRACE_AUDIT_CRON: z.string().default('40 */2 * * *'),
    TRACE_AUDIT_RECHECK_HOURS: z.string().default('168').transform(Number),
    TRACE_AUDIT_MAX_RPC: z.string().default('500').transform(Number),
    TRACE_AUDIT_MAX_FETCHES: z.string().default('100').transform(Number),
    TRACE_AUDIT_MAX_BYTES: z.string().default('2097152').transform(Number),
    TRACE_AUDIT_VERDICT_RPC_SHARE: z.string().default('0.3').transform(Number).pipe(z.number().gt(0).lte(1)),
    TRACE_VERDICT_CRON: z.string().default('*/10 * * * *'),
    TRACE_VERDICT_MAX_RPC: z.string().default('100').transform(Number).pipe(z.number().int().min(1)),

    // ── Trace publication queue (Issue #131) ──────────────────────────────
    TRACE_PUBLISH_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
    TRACE_PUBLISH_CRON: z.string().default('*/30 * * * * *'),
    TRACE_PUBLISH_MAX_ATTEMPTS: z
      .string()
      .default('8')
      .transform(Number)
      .refine((n) => Number.isInteger(n) && n >= 1 && n <= 100, 'must be an integer between 1 and 100'),
    TRACE_CONFIRM_TIMEOUT_MS: z
      .string()
      .default('600000')
      .transform(Number)
      .refine((n) => Number.isInteger(n) && n >= 10_000, 'must be an integer >= 10000'),

    // ── Market seed policy (Issue #82) ────────────────────────────────────
    // Per-market cap on the expected LP loss to an informed trader (7-decimal base units).
    LP_LOSS_BUDGET_RAW: rawUsdc('250000000'),
    // Share of the treasury's max_daily the market maker may use for seeds.
    MM_DAILY_SHARE_BPS: z.string().default('4000').transform(Number).pipe(z.number().int().min(0).max(10000)),
    // Largest seed as a share of the treasury's available capital.
    MAX_SEED_FRACTION_BPS: z.string().default('500').transform(Number).pipe(z.number().int().min(1).max(10000)),
    // Cap on the seed capital sitting in unresolved markets.
    MAX_UNRESOLVED_SEEDED_RAW: rawUsdc('10000000000'),
    SEED_CATEGORY_BASE_USDC: seedCategoryBase,

    // ── Market correlations (Issue #80) ───────────────────────────────────
    CORRELATION_GRID_SECS: z.string().default('3600').transform(Number)
      .pipe(z.number().int().min(60)),
    CORRELATION_WINDOW_DAYS: z.string().default('14').transform(Number)
      .pipe(z.number().int().min(1).max(90)),
    CORRELATION_MIN_OVERLAP: z.string().default('12').transform(Number)
      .pipe(z.number().int().min(2)),
    CORRELATION_PRIOR_KAPPA: z.string().default('20').transform(Number)
      .pipe(z.number().positive()),

    // ── Portfolio risk (Issue #280) ───────────────────────────────────────
    // Monte Carlo paths per run, the largest positions kept, the shrinkage
    // applied to snapshot correlations, and a soft wall-clock budget.
    RISK_MC_PATHS: z.string().default('20000').transform(Number)
      .pipe(z.number().int().min(100)),
    RISK_MAX_MARKETS: z.string().default('150').transform(Number)
      .pipe(z.number().int().min(1)),
    RISK_RHO_SHRINK: z.string().default('0.8').transform(Number)
      .pipe(z.number().min(0).max(1)),
    RISK_MAX_DURATION_MS: z.string().default('10000').transform(Number)
      .pipe(z.number().int().positive()),
    // Expected-shortfall gate (bps of bankroll); off by default. Exported by the
    // service, not yet enforced by any caller.
    RISK_GATE_ENABLED: boolDefault('false'),
    RISK_MAX_ES_BPS: z.string().default('500').transform(Number)
      .pipe(z.number().int().min(0).max(10_000)),

    // ── Market lifecycle reconciler (Issue #83) ───────────────────────────
    RECONCILE_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
    RECONCILE_MAX_MARKETS: z.string().default('200').transform(Number)
      .pipe(z.number().int().min(1).max(5000)),
    RECONCILE_CONCURRENCY: z.string().default('4').transform(Number)
      .pipe(z.number().int().min(1).max(32)),
    RECONCILE_MAX_RPC_CALLS: z.string().default('400').transform(Number)
      .pipe(z.number().int().min(1)),
    // How far (in ledgers) the indexer may trail an observation before
    // resolution findings are deferred to it.
    RECONCILE_INDEXER_LAG_LEDGERS: z.string().default('20').transform(Number)
      .pipe(z.number().int().min(0)),

    // ── Money audit (Issue #222) ──────────────────────────────────────────
    MONEY_AUDIT_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
    // Guarded repairs (re-running idempotent handlers); off by default.
    MONEY_AUDIT_AUTO_REPAIR: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
    // A subject updated this recently is in flight, not drift.
    MONEY_AUDIT_GRACE_MS: z.string().default('120000').transform(Number)
      .pipe(z.number().int().min(0)),
    // A PENDING trade with no in-flight outbox row older than this is stuck.
    MONEY_AUDIT_PENDING_GRACE_MS: z.string().default('3600000').transform(Number)
      .pipe(z.number().int().min(0)),
    MONEY_AUDIT_MAX_RPC_CALLS: z.string().default('200').transform(Number)
      .pipe(z.number().int().min(0)),

    // ── Copy Trading (Issue #151, #294) ───────────────────────────────────
    COPY_TRADE_TTL_MINUTES: z.string().default('30').transform(Number),
    COPY_TRADE_MAX_PENDING: z.string().default('5').transform(Number),
    COPY_TRADE_MAX_IMPACT_BPS: z.string().optional()
      .transform((v) => (v == null || v === '' ? null : Number(v)))
      .pipe(z.number().int().min(1).max(10_000).nullable()),
    COPY_TRADE_FLOW_WINDOW_MINUTES: z.string().default('60').transform(Number)
      .pipe(z.number().int().min(1).max(10_080)),
    COPY_TRADE_POOL_MAX_AGE_LEDGERS: z.string().default('12').transform(Number)
      .pipe(z.number().int().min(0)),

    // ── Socket.io throttling & slow-consumer guard (Issue #96) ─────────────
    SOCKET_PRICE_TICK_MS: z.string().default('1000').transform(Number),
    SOCKET_TRADE_VOLATILE: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
    // A chain event at or above (RPC latest ledger − this) is live; older
    // events are catch-up and never emitted as live prices (#291).
    SOCKET_LIVE_LEDGER_LAG: z.string().default('12').transform(Number)
      .pipe(z.number().int().min(0).max(1000)),
    SOCKET_SLOW_WARN_BYTES: z.string().default('262144').transform(Number),
    SOCKET_SLOW_DROP_BYTES: z.string().default('2097152').transform(Number),
    SOCKET_SLOW_CHECK_MS: z.string().default('2000').transform(Number),

    // ── Redis Streams adapter bounds and observability (#293) ──────────────
    // Explicit stream cap and batch size, sized against the emit rate and the
    // tolerated lag instead of the adapter's implicit 10,000 / 100 defaults.
    SOCKET_STREAM_NAME: z.string().default('oracledesk:socket.io'),
    SOCKET_ADAPTER_MAXLEN: z.string().default('10000').transform(Number)
      .pipe(z.number().int().min(100)),
    SOCKET_ADAPTER_READ_COUNT: z.string().default('100').transform(Number)
      .pipe(z.number().int().min(1).max(1000)),
    SOCKET_ADAPTER_BLOCK_MS: z.string().default('1000').transform(Number)
      .pipe(z.number().int().min(100).max(30000)),
    SOCKET_ADAPTER_BLOCKING_TIMEOUT_MS: z.string().default('5000').transform(Number)
      .pipe(z.number().int().min(200).max(60000)),
    SOCKET_ADAPTER_MONITOR_MS: z.string().default('5000').transform(Number)
      .pipe(z.number().int().min(500)),
    // Warn when this instance is this far behind the stream tail.
    SOCKET_ADAPTER_LAG_WARN_ENTRIES: z.string().default('500').transform(Number)
      .pipe(z.number().int().min(1)),
    SOCKET_ADAPTER_LAG_WARN_MS: z.string().default('5000').transform(Number)
      .pipe(z.number().int().min(100)),
    // Above this lag, coalescable public traffic is shed (private/admin never).
    SOCKET_ADAPTER_SHED_LAG_ENTRIES: z.string().default('2000').transform(Number)
      .pipe(z.number().int().min(1)),

    // ── Socket.io hardening & limits (Issue #97) ──────────────────────────
    SOCKET_MAX_CONNECTIONS: z.string().default('5000').transform(Number),
    SOCKET_MAX_PER_IP: z.string().default('20').transform(Number),
    SOCKET_CONNECT_RATE_PER_MIN: z.string().default('60').transform(Number),
    SOCKET_MAX_BUFFER_BYTES: z.string().default('16384').transform(Number),
    SOCKET_TRANSPORTS: commaList(z.enum(['websocket', 'polling']), 'websocket,polling'),
    SOCKET_INBOUND_EVENTS_PER_10S: z.string().default('20').transform(Number),
    SOCKET_LOG_SAMPLE_RATE: z.string().default('0.01').transform(Number),
    TRUSTED_PROXIES: commaList(z.string(), ''),
    SOCKET_IP_EXEMPT_CIDRS: commaList(z.string(), ''),

    // ── Chain read cache (Issue #98) ───────────────────────────────────────
    CHAIN_CACHE_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
    CHAIN_CACHE_TTL_MS: z.string().default('5000').transform(Number),
    CHAIN_CACHE_NEG_TTL_MS: z.string().default('2000').transform(Number),
    CHAIN_CACHE_WAIT_MS: z.string().default('1500').transform(Number),
  });

export const envSchema = envObjectSchema
  .superRefine((env, ctx) => {
    // ── Login signing-key rotation (#48) ──
    const currentPublic =
      env.AUTH_SIGNING_SECRET && StrKey.isValidEd25519SecretSeed(env.AUTH_SIGNING_SECRET)
        ? Keypair.fromSecret(env.AUTH_SIGNING_SECRET).publicKey()
        : null;
    if (env.AUTH_SIGNING_SECRET && env.AGENT_SECRET_KEY && env.AUTH_SIGNING_SECRET === env.AGENT_SECRET_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_SIGNING_SECRET'],
        message: 'must differ from AGENT_SECRET_KEY',
      });
    }
    const seenPrevious = new Set<string>();
    const maxRetire = Date.now() + 24 * 60 * 60 * 1000;
    for (const key of env.AUTH_PREVIOUS_SIGNING_KEYS) {
      if (seenPrevious.has(key.publicKey)) {
        ctx.addIssue({
          code: 'custom',
          path: ['AUTH_PREVIOUS_SIGNING_KEYS'],
          message: `duplicate previous signing key ${key.publicKey}`,
        });
        continue;
      }
      seenPrevious.add(key.publicKey);
      if (currentPublic && key.publicKey === currentPublic) {
        ctx.addIssue({
          code: 'custom',
          path: ['AUTH_PREVIOUS_SIGNING_KEYS'],
          message: 'must not contain the current signing key',
        });
      }
      if (env.NODE_ENV === 'production' && !key.retireAt) {
        ctx.addIssue({
          code: 'custom',
          path: ['AUTH_PREVIOUS_SIGNING_KEYS'],
          message: 'every previous signing key needs a retirement time in production (G…@ISO-8601)',
        });
      }
      if (key.retireAt && key.retireAt.getTime() > maxRetire) {
        ctx.addIssue({
          code: 'custom',
          path: ['AUTH_PREVIOUS_SIGNING_KEYS'],
          message: 'retirement time must be at most 24 hours in the future',
        });
      }
    }
    if (env.SEP45_ENABLED && !env.WEB_AUTH_CONTRACT_ID) {
      ctx.addIssue({
        code: 'custom',
        path: ['WEB_AUTH_CONTRACT_ID'],
        message: 'is required when SEP45_ENABLED=true',
      });
    }
    if (env.SECRETS_PROVIDER === 'vault') {
      if (!env.VAULT_ADDR) ctx.addIssue({ code: 'custom', path: ['VAULT_ADDR'], message: 'is required when SECRETS_PROVIDER=vault' });
      else if (!URL.canParse(env.VAULT_ADDR)) ctx.addIssue({ code: 'custom', path: ['VAULT_ADDR'], message: 'must be a URL' });
      if (!env.VAULT_TOKEN_FILE) ctx.addIssue({ code: 'custom', path: ['VAULT_TOKEN_FILE'], message: 'is required when SECRETS_PROVIDER=vault' });
      if (!env.VAULT_KV_PATH) ctx.addIssue({ code: 'custom', path: ['VAULT_KV_PATH'], message: 'is required when SECRETS_PROVIDER=vault' });
    }
    if (env.NODE_ENV === 'production' && env.IPFS_TRANSPORT === 'local') {
      ctx.addIssue({ code: 'custom', path: ['IPFS_TRANSPORT'], message: 'local IPFS is development-only' });
    }
    if (env.NODE_ENV === 'production' && env.IPFS_MIN_REPLICAS < 2) {
      ctx.addIssue({
        code: 'custom',
        path: ['IPFS_MIN_REPLICAS'],
        message: 'must be >= 2 in production for redundant IPFS pin replication',
      });
    }
    if (env.PROCESS_ROLE === 'indexer') {
      if (!env.INDEXER_ENABLED) {
        ctx.addIssue({
          code: 'custom',
          path: ['INDEXER_ENABLED'],
          message: 'must be true when PROCESS_ROLE=indexer',
        });
      }
      if (!env.EVENT_BUS_ENABLED) {
        ctx.addIssue({
          code: 'custom',
          path: ['EVENT_BUS_ENABLED'],
          message: 'must be true when PROCESS_ROLE=indexer so published events reach api pods',
        });
      }
    }
    if (env.X402_ENABLED) {
      if (!env.X402_FACILITATOR_URL) {
        ctx.addIssue({ code: 'custom', path: ['X402_FACILITATOR_URL'], message: 'is required when X402_ENABLED=true' });
      } else if (!URL.canParse(env.X402_FACILITATOR_URL) || !/^https?:\/\//.test(env.X402_FACILITATOR_URL)) {
        ctx.addIssue({ code: 'custom', path: ['X402_FACILITATOR_URL'], message: 'must be an http(s) URL' });
      }
      if (!/^[a-z0-9-]+:[a-z0-9-]+$/i.test(env.X402_NETWORK)) {
        ctx.addIssue({ code: 'custom', path: ['X402_NETWORK'], message: 'must be a CAIP-2 network id such as stellar:testnet' });
      }
    }
    if (env.CHAIN_EXECUTION_MODE === 'live') {
      if (env.CORROBORATION_MODE !== 'enforce' && !env.CORROBORATION_ALLOW_OBSERVE_LIVE) {
        ctx.addIssue({
          code: 'custom',
          path: ['CORROBORATION_MODE'],
          message: 'must be enforce when CHAIN_EXECUTION_MODE=live (or set CORROBORATION_ALLOW_OBSERVE_LIVE=true)',
        });
      }
      if (!env.AGENT_SECRET_KEY) {
        ctx.addIssue({ code: 'custom', path: ['AGENT_SECRET_KEY'], message: 'is required when CHAIN_EXECUTION_MODE=live' });
      }
      if (env.STELLAR_NETWORK_PASSPHRASE !== Networks.TESTNET) {
        ctx.addIssue({
          code: 'custom',
          path: ['STELLAR_NETWORK_PASSPHRASE'],
          message: 'live mode is testnet-only; use the testnet passphrase',
        });
      }
    }
    if (env.FEE_BUMP_ENABLED) {
      if (!env.FEE_PAYER_SECRET) {
        ctx.addIssue({ code: 'custom', path: ['FEE_PAYER_SECRET'], message: 'is required when FEE_BUMP_ENABLED=true' });
      }
      if (env.STELLAR_NETWORK_PASSPHRASE !== Networks.TESTNET) {
        ctx.addIssue({ code: 'custom', path: ['FEE_PAYER_SECRET'], message: 'fee bumps are testnet-only' });
      }
    }
    if (env.FEE_PAYER_SECRET) {
      if (!StrKey.isValidEd25519SecretSeed(env.FEE_PAYER_SECRET)) {
        ctx.addIssue({ code: 'custom', path: ['FEE_PAYER_SECRET'], message: 'must be a Stellar secret seed (S…)' });
      }
      if (env.FEE_PAYER_SECRET === env.AGENT_SECRET_KEY) {
        ctx.addIssue({ code: 'custom', path: ['FEE_PAYER_SECRET'], message: 'must differ from AGENT_SECRET_KEY' });
      }
      if (env.FEE_PAYER_SECRET === env.AUTH_SIGNING_SECRET) {
        ctx.addIssue({ code: 'custom', path: ['FEE_PAYER_SECRET'], message: 'must differ from AUTH_SIGNING_SECRET' });
      }
    }
    if (env.X402_ALLOWANCE_HMAC_SECRET) {
      for (const [label, other] of [
        ['X402_KEY_RELEASE_SECRET', env.X402_KEY_RELEASE_SECRET],
        ['JWT_SECRET', env.JWT_SECRET],
      ] as const) {
        if (other && env.X402_ALLOWANCE_HMAC_SECRET === other) {
          ctx.addIssue({ code: 'custom', path: ['X402_ALLOWANCE_HMAC_SECRET'], message: `must differ from ${label}` });
        }
      }
    }
    if (env.URI_REQUEST_SIGNING_SECRET) {
      if (!StrKey.isValidEd25519SecretSeed(env.URI_REQUEST_SIGNING_SECRET)) {
        ctx.addIssue({ code: 'custom', path: ['URI_REQUEST_SIGNING_SECRET'], message: 'must be a Stellar secret seed (S…)' });
      }
      if (env.URI_REQUEST_SIGNING_SECRET === env.AUTH_SIGNING_SECRET) {
        ctx.addIssue({ code: 'custom', path: ['URI_REQUEST_SIGNING_SECRET'], message: 'must differ from AUTH_SIGNING_SECRET' });
      }
      if (env.URI_REQUEST_SIGNING_SECRET === env.AGENT_SECRET_KEY) {
        ctx.addIssue({ code: 'custom', path: ['URI_REQUEST_SIGNING_SECRET'], message: 'must differ from AGENT_SECRET_KEY' });
      }
      if (env.URI_REQUEST_SIGNING_SECRET === env.FEE_PAYER_SECRET) {
        ctx.addIssue({ code: 'custom', path: ['URI_REQUEST_SIGNING_SECRET'], message: 'must differ from FEE_PAYER_SECRET' });
      }
      const cbBase = env.SEP7_CALLBACK_BASE_URL || env.PUBLIC_API_BASE_URL;
      if (env.NODE_ENV === 'production' && cbBase && !cbBase.startsWith('https://')) {
        ctx.addIssue({ code: 'custom', path: ['SEP7_CALLBACK_BASE_URL'], message: 'must use https:// in production' });
      }
    }

    // ── Channel Accounts validation (#37) ──
    const channelKeys: string[] = [];
    if (env.CHANNEL_SECRET_KEYS) {
      for (const k of env.CHANNEL_SECRET_KEYS.split(',')) {
        const trimmed = k.trim();
        if (trimmed) channelKeys.push(trimmed);
      }
    }
    if (env.CHANNELS_SECRETS_FILE && fs.existsSync(env.CHANNELS_SECRETS_FILE)) {
      try {
        const content = fs.readFileSync(env.CHANNELS_SECRETS_FILE, 'utf-8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#') && StrKey.isValidEd25519SecretSeed(trimmed)) {
            channelKeys.push(trimmed);
          }
        }
      } catch {
        ctx.addIssue({ code: 'custom', path: ['CHANNELS_SECRETS_FILE'], message: 'could not read channels secrets file' });
      }
    }

    if (channelKeys.length > 0) {
      if (env.CHAIN_EXECUTION_MODE === 'live' && env.STELLAR_NETWORK_PASSPHRASE !== Networks.TESTNET) {
        ctx.addIssue({
          code: 'custom',
          path: ['CHANNEL_SECRET_KEYS'],
          message: 'channel accounts are testnet-only',
        });
      }
      const seenChannels = new Set<string>();
      for (const key of channelKeys) {
        if (!StrKey.isValidEd25519SecretSeed(key)) {
          ctx.addIssue({
            code: 'custom',
            path: ['CHANNEL_SECRET_KEYS'],
            message: 'contains invalid Stellar secret seed',
          });
          continue;
        }
        if (seenChannels.has(key)) {
          ctx.addIssue({
            code: 'custom',
            path: ['CHANNEL_SECRET_KEYS'],
            message: 'duplicate channel secret key configured',
          });
        }
        seenChannels.add(key);

        if (env.AGENT_SECRET_KEY && key === env.AGENT_SECRET_KEY) {
          ctx.addIssue({
            code: 'custom',
            path: ['CHANNEL_SECRET_KEYS'],
            message: 'channel secret key must not equal AGENT_SECRET_KEY',
          });
        }
        if (env.AUTH_SIGNING_SECRET && key === env.AUTH_SIGNING_SECRET) {
          ctx.addIssue({
            code: 'custom',
            path: ['CHANNEL_SECRET_KEYS'],
            message: 'channel secret key must not equal AUTH_SIGNING_SECRET',
          });
        }
      }
    }
    // ── Trace signing key validation (#273) ──
    if (env.TRACE_SIGNING_KEY) {
      let tracePubHex: string | null = null;
      const trimmed = env.TRACE_SIGNING_KEY.trim();
      try {
        if (StrKey.isValidEd25519SecretSeed(trimmed)) {
          tracePubHex = Buffer.from(Keypair.fromSecret(trimmed).rawPublicKey()).toString('hex');
        } else if (/^[0-9a-f]{64}$/i.test(trimmed)) {
          tracePubHex = Buffer.from(Keypair.fromRawEd25519Seed(Buffer.from(trimmed, 'hex')).rawPublicKey()).toString('hex');
        } else {
          ctx.addIssue({
            code: 'custom',
            path: ['TRACE_SIGNING_KEY'],
            message: 'must be a Stellar secret seed (S…) or 64-char hex Ed25519 seed',
          });
        }
      } catch {
        ctx.addIssue({
          code: 'custom',
          path: ['TRACE_SIGNING_KEY'],
          message: 'must be a valid Ed25519 seed',
        });
      }
      if (tracePubHex) {
        const otherSecrets: Array<[string, string | undefined]> = [
          ['AGENT_SECRET_KEY', env.AGENT_SECRET_KEY],
          ['AUTH_SIGNING_SECRET', env.AUTH_SIGNING_SECRET],
          ['FEE_PAYER_SECRET', env.FEE_PAYER_SECRET],
          ['URI_REQUEST_SIGNING_SECRET', env.URI_REQUEST_SIGNING_SECRET],
          ...channelKeys.map((k, idx) => [`CHANNEL_SECRET_KEYS[${idx}]`, k] as [string, string]),
        ];
        for (const [label, other] of otherSecrets) {
          if (!other || !StrKey.isValidEd25519SecretSeed(other)) continue;
          const otherPubHex = Buffer.from(Keypair.fromSecret(other).rawPublicKey()).toString('hex');
          if (otherPubHex === tracePubHex) {
            ctx.addIssue({
              code: 'custom',
              path: ['TRACE_SIGNING_KEY'],
              message: `must differ from ${label}`,
            });
          }
        }
      }
    }
    if (env.FEE_POLICY_JSON) {
      try {
        const parsed = JSON.parse(env.FEE_POLICY_JSON);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          ctx.addIssue({ code: 'custom', path: ['FEE_POLICY_JSON'], message: 'must be a JSON object' });
        } else {
          const validClasses = ['market_create', 'trade', 'trace_publish', 'maintenance'];
          const validPercentiles = ['p10', 'p20', 'p30', 'p40', 'p50', 'p60', 'p70', 'p80', 'p90', 'p95', 'p99', 'min', 'mode', 'max'];
          for (const [k, v] of Object.entries(parsed)) {
            if (!validClasses.includes(k)) {
              ctx.addIssue({ code: 'custom', path: ['FEE_POLICY_JSON', k], message: `unknown operation class: ${k}` });
            } else if (v && typeof v === 'object' && !Array.isArray(v)) {
              const pol = v as any;
              if (pol.percentile && !validPercentiles.includes(pol.percentile)) {
                ctx.addIssue({ code: 'custom', path: ['FEE_POLICY_JSON', k, 'percentile'], message: `invalid percentile: ${pol.percentile}` });
              }
              if (pol.floor !== undefined && (!/^\d+$/.test(String(pol.floor)) || BigInt(pol.floor) < 0n)) {
                ctx.addIssue({ code: 'custom', path: ['FEE_POLICY_JSON', k, 'floor'], message: 'floor must be a non-negative integer' });
              }
              if (pol.cap !== undefined && (!/^\d+$/.test(String(pol.cap)) || BigInt(pol.cap) < 0n)) {
                ctx.addIssue({ code: 'custom', path: ['FEE_POLICY_JSON', k, 'cap'], message: 'cap must be a non-negative integer' });
              }
              if (pol.budget !== undefined && (!/^\d+$/.test(String(pol.budget)) || BigInt(pol.budget) < 0n)) {
                ctx.addIssue({ code: 'custom', path: ['FEE_POLICY_JSON', k, 'budget'], message: 'budget must be a non-negative integer' });
              }
              if (pol.floor !== undefined && pol.cap !== undefined && BigInt(pol.floor) > BigInt(pol.cap)) {
                ctx.addIssue({ code: 'custom', path: ['FEE_POLICY_JSON', k], message: 'floor cannot exceed cap' });
              }
            } else {
              ctx.addIssue({ code: 'custom', path: ['FEE_POLICY_JSON', k], message: 'must be an object' });
            }
          }
        }
      } catch {
        ctx.addIssue({ code: 'custom', path: ['FEE_POLICY_JSON'], message: 'must be valid JSON' });
      }
    }
  });

export type Config = z.infer<typeof envSchema> & {
  /** Secrets generated for this process because they were not configured. */
  ephemeralSecrets: string[];
};

export class ConfigError extends Error {}

/** Parses an env object. Throws ConfigError naming every bad variable. */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  let resolvedEnv: NodeJS.ProcessEnv;
  try {
    resolvedEnv = resolveFileVars(env);
  } catch (err) {
    throw new ConfigError(`Invalid environment configuration:\n  ${err instanceof Error ? err.message : String(err)}`);
  }

  // #243: keys that are set but do nothing. Computed on the raw env so
  // <SECRET>_FILE names are still visible.
  const configWarnings = collectConfigWarnings(env, Object.keys(envObjectSchema.shape), SECRET_NAMES);
  applyDeprecatedAliases(resolvedEnv);

  if (resolvedEnv.CHAIN_CACHE_ENABLED === undefined) {
    resolvedEnv.CHAIN_CACHE_ENABLED = (resolvedEnv.NODE_ENV || env.NODE_ENV) === 'test' ? 'false' : 'true';
  }

  const parsed = envSchema.safeParse(resolvedEnv);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.') || '(root)'} ${i.message}`);
    throw new ConfigError(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  const data = parsed.data;
  if (configWarnings.length > 0) {
    if (data.CONFIG_STRICT) {
      throw new ConfigError(
        `Invalid environment configuration (CONFIG_STRICT=true):\n${configWarnings.map((w) => `  ${w.message}`).join('\n')}`,
      );
    }
    if (data.NODE_ENV !== 'test') emitConfigWarnings(configWarnings);
  }
  // Using <NAME>_FILE implies the file provider, so refresh re-reads the
  // mounts instead of the (possibly empty) plain environment variable.
  if (
    data.SECRETS_PROVIDER === 'env' &&
    SECRET_NAMES.some((name) => Boolean(resolvedEnv[`${name}_FILE`]))
  ) {
    data.SECRETS_PROVIDER = 'file';
  }

  const problems = validateSecrets(data, data.NODE_ENV, {
    // A remote provider supplies secret values after loadConfig; boot-time
    // presence checks move to initSecrets().
    requireProductionSecrets: data.SECRETS_PROVIDER !== 'vault',
  });
  if (problems.length > 0) {
    throw new ConfigError(`Invalid environment configuration:\n${problems.map((p) => `  ${p}`).join('\n')}`);
  }

  const ephemeralSecrets: string[] = [];
  if (!data.JWT_SECRET && data.NODE_ENV !== 'production') {
    data.JWT_SECRET = crypto.randomBytes(32).toString('hex');
    ephemeralSecrets.push('JWT_SECRET');
  }
  if (!data.AUTH_SIGNING_SECRET && data.NODE_ENV !== 'production') {
    data.AUTH_SIGNING_SECRET = Keypair.random().secret();
    ephemeralSecrets.push('AUTH_SIGNING_SECRET');
  }
  if (!data.ENTITLEMENT_SIGNING_KEY && data.NODE_ENV !== 'production') {
    // Generated, never printed. Dev/test only: tokens stop verifying on restart.
    data.ENTITLEMENT_SIGNING_KEY = generateEntitlementKey();
    ephemeralSecrets.push('ENTITLEMENT_SIGNING_KEY');
  }
  if (!data.RECEIPT_SIGNING_KEY && data.NODE_ENV !== 'production') {
    data.RECEIPT_SIGNING_KEY = generateEntitlementKey();
    ephemeralSecrets.push('RECEIPT_SIGNING_KEY');
  }
  if (!data.AUTH_WEB_AUTH_DOMAIN) data.AUTH_WEB_AUTH_DOMAIN = data.AUTH_HOME_DOMAIN;
  if (!data.SEP7_ORIGIN_DOMAIN) data.SEP7_ORIGIN_DOMAIN = data.AUTH_HOME_DOMAIN;
  if (!data.SEP7_CALLBACK_BASE_URL) data.SEP7_CALLBACK_BASE_URL = data.PUBLIC_API_BASE_URL;
  if (!data.SEP45_RPC_URL) data.SEP45_RPC_URL = data.STELLAR_RPC_URL;
  if (!data.AUTH_IP_HASH_SALT) {
    // A per-process salt still makes IPs unlinkable across instances; set
    // AUTH_IP_HASH_SALT explicitly to keep hashes stable across restarts.
    data.AUTH_IP_HASH_SALT = crypto.randomBytes(16).toString('hex');
  }
  // Prisma's env("DATABASE_URL") reads this process-wide value at client build.
  if (data.DATABASE_URL) process.env.DATABASE_URL = data.DATABASE_URL;
  return { ...data, ephemeralSecrets };
}

function loadOrExit(): Config {
  try {
    return loadConfig(process.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}

export const config = loadOrExit();
