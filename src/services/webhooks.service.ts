/**
 * Outbound webhooks (#128): signed, durable, at-least-once delivery of
 * market / trade / resolution / trace events to user-registered endpoints.
 *
 * Flow
 * 1. The indexer calls `enqueueEvent` for each newly stored chain event. One
 *    `webhook_events` row per domain event, keyed "<type>:<chain event id>"
 *    (ON CONFLICT DO NOTHING, so replays are no-ops), plus one
 *    `webhook_deliveries` row per matching ACTIVE subscription.
 * 2. The worker claims due deliveries, at most one per subscription (the
 *    oldest pending by creation order), leasing them by pushing nextAttemptAt
 *    forward inside the claim so concurrent workers never double-send.
 * 3. Each delivery is POSTed through the SSRF guard with an HMAC-SHA256
 *    signature over the exact bytes sent. 2xx = success; anything else is
 *    retried with exponential backoff and jitter (honouring Retry-After), up
 *    to MAX_ATTEMPTS, then dead-lettered.
 * 4. Subscriptions failing for DISABLE_AFTER_FAILURES consecutive attempts or
 *    DISABLE_AFTER_MS are disabled automatically; owners re-enable via PATCH.
 *
 * Delivery is at-least-once: receivers dedupe on `OracleDesk-Event-Id`.
 */
import crypto from 'crypto';
import { Prisma, type MarketCategory } from '@prisma/client';
import { config } from '../config';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { canonicalBytes, canonicalJson } from '../utils/hash.util';
import { safeFetch, SsrfError, type GuardOptions } from '../lib/ssrf-guard';

// ─── Event types ────────────────────────────────────────────────────────────

export const WEBHOOK_EVENT_TYPES = ['market.created', 'market.resolved', 'trade.executed', 'trace.published'] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

// ─── Policy ─────────────────────────────────────────────────────────────────

export const MAX_ATTEMPTS = 15;
export const BASE_BACKOFF_MS = 60_000;
export const MAX_BACKOFF_MS = 24 * 60 * 60_000;
export const DISABLE_AFTER_FAILURES = 50;
export const DISABLE_AFTER_MS = 5 * 24 * 60 * 60_000;
export const DELIVERY_TIMEOUT_MS = 10_000;
export const SECRET_ROTATION_OVERLAP_MS = 24 * 60 * 60_000;
export const SIGNATURE_TOLERANCE_SEC = 300;
export const MAX_SUBSCRIPTIONS_PER_USER = 10;
export const RETENTION_DAYS = 30;
const WORKER_INTERVAL_MS = 2_000;
const CLAIM_BATCH = 20;
const LEASE_SECONDS = 60;

export function guardOptions(): GuardOptions {
  return { production: config.NODE_ENV === 'production', allowHttp: config.WEBHOOKS_ALLOW_HTTP };
}

// ─── Secrets (AES-256-GCM at rest) ──────────────────────────────────────────

function secretKey(): Buffer {
  return Buffer.from(config.WEBHOOK_SECRET_KEY, 'base64');
}

/** New plaintext signing secret. Returned to the owner only on create/rotate. */
export function generateSecret(): string {
  return `whsec_${crypto.randomBytes(32).toString('base64url')}`;
}

/** Encrypts a secret as "iv.tag.ciphertext" (base64). */
export function encryptSecret(plain: string, key = secretKey()): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

export function decryptSecret(stored: string, key = secretKey()): string {
  const [iv, tag, data] = stored.split('.').map((part) => Buffer.from(part, 'base64'));
  if (!iv || !tag || !data) throw new Error('Malformed encrypted webhook secret');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

// ─── Signing ────────────────────────────────────────────────────────────────

export function computeSignature(secret: string, timestamp: number, rawBody: Buffer | string): string {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
}

/**
 * `OracleDesk-Signature: t=<unix>,v1=<hex>[,v1=<hex>]`. During a rotation
 * overlap the body is signed with both the new and the previous secret.
 */
export function signatureHeader(secrets: string[], timestamp: number, rawBody: Buffer | string): string {
  return [`t=${timestamp}`, ...secrets.map((s) => `v1=${computeSignature(s, timestamp, rawBody)}`)].join(',');
}

/**
 * Reference verifier for receivers (and tests). Accepts if any v1 signature
 * matches any of `secrets` and the timestamp is within `toleranceSec`.
 */
export function verifyWebhookSignature(
  rawBody: Buffer | string,
  header: string,
  secrets: string[],
  toleranceSec = SIGNATURE_TOLERANCE_SEC,
  nowSec = Math.floor(Date.now() / 1000),
): boolean {
  const parts = header.split(',').map((p) => p.trim());
  const t = Number(parts.find((p) => p.startsWith('t='))?.slice(2));
  if (!Number.isInteger(t) || Math.abs(nowSec - t) > toleranceSec) return false;
  const provided = parts.filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  return secrets.some((secret) => {
    const expected = Buffer.from(computeSignature(secret, t, rawBody), 'hex');
    return provided.some((sig) => {
      const given = Buffer.from(sig, 'hex');
      return given.length === expected.length && crypto.timingSafeEqual(given, expected);
    });
  });
}

/** Secrets to sign with: current, plus previous during the rotation overlap. */
export function signingSecrets(
  sub: { secret: string; previousSecret: string | null; secretRotatedAt: Date | null },
  now = new Date(),
  decrypt: (s: string) => string = decryptSecret,
): string[] {
  const secrets = [decrypt(sub.secret)];
  if (sub.previousSecret && sub.secretRotatedAt && now.getTime() - sub.secretRotatedAt.getTime() < SECRET_ROTATION_OVERLAP_MS) {
    secrets.push(decrypt(sub.previousSecret));
  }
  return secrets;
}

// ─── Retry policy ───────────────────────────────────────────────────────────

/** Backoff after the `attempts`-th failure: 1 min doubling, capped at 24 h, ±20% jitter. */
export function backoffMs(attempts: number, rand = Math.random()): number {
  const base = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1));
  return Math.round(base * (0.8 + 0.4 * rand));
}

/** Parses Retry-After (seconds or HTTP date) into ms from now, capped at 24 h. */
export function parseRetryAfter(value: string | string[] | undefined, now = Date.now()): number | null {
  const v = Array.isArray(value) ? value[0] : value;
  if (!v) return null;
  const secs = Number(v);
  const ms = Number.isFinite(secs) ? secs * 1000 : Date.parse(v) - now;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.min(ms, MAX_BACKOFF_MS);
}

export interface FailurePlan {
  status: 'PENDING' | 'DEAD';
  attempts: number;
  nextAttemptAt: Date;
  consecutiveFailures: number;
  failingSince: Date;
  disableReason: string | null;
}

/** Pure decision for a failed attempt. */
export function planFailure(
  delivery: { attempts: number },
  sub: { consecutiveFailures: number; failingSince: Date | null },
  opts: { now: Date; retryAfterMs?: number | null; rand?: number },
): FailurePlan {
  const attempts = delivery.attempts + 1;
  const consecutiveFailures = sub.consecutiveFailures + 1;
  const failingSince = sub.failingSince ?? opts.now;
  const wait = Math.max(backoffMs(attempts, opts.rand), opts.retryAfterMs ?? 0);
  let disableReason: string | null = null;
  if (consecutiveFailures >= DISABLE_AFTER_FAILURES) {
    disableReason = `Disabled after ${consecutiveFailures} consecutive failed deliveries`;
  } else if (opts.now.getTime() - failingSince.getTime() >= DISABLE_AFTER_MS) {
    disableReason = 'Disabled after failing for 5 days';
  }
  return {
    status: attempts >= MAX_ATTEMPTS ? 'DEAD' : 'PENDING',
    attempts,
    nextAttemptAt: new Date(opts.now.getTime() + wait),
    consecutiveFailures,
    failingSince,
    disableReason,
  };
}

// ─── Producing events (outbox) ──────────────────────────────────────────────

type Db = Pick<Prisma.TransactionClient, '$executeRaw'>;

export interface EventMatch {
  onChainMarketId: bigint;
  /** Backend category when the market is known; null matches only unfiltered subscriptions. */
  category?: MarketCategory | null;
}

/**
 * Records a domain event and fans it out to matching active subscriptions.
 * Idempotent per (type, sourceEventId): a replayed chain event inserts
 * nothing. Returns the number of deliveries created.
 */
export async function enqueueEvent(
  db: Db,
  type: WebhookEventType,
  sourceEventId: string,
  payload: object,
  match: EventMatch,
): Promise<number> {
  const id = `${type}:${sourceEventId}`;
  const inserted = await db.$executeRaw`
    INSERT INTO "webhook_events" ("id", "type", "payload")
    VALUES (${id}, ${type}, ${canonicalJson(payload)}::jsonb)
    ON CONFLICT ("id") DO NOTHING`;
  if (inserted === 0) return 0;

  const category = match.category ?? null;
  return db.$executeRaw`
    INSERT INTO "webhook_deliveries" ("id", "eventId", "subscriptionId", "status", "nextAttemptAt", "updatedAt")
    SELECT gen_random_uuid()::text, ${id}, s."id", 'PENDING', now(), now()
    FROM "webhook_subscriptions" s
    WHERE s."status" = 'ACTIVE'
      AND ${type} = ANY(s."eventTypes")
      AND (cardinality(s."marketIds") = 0 OR ${match.onChainMarketId}::bigint = ANY(s."marketIds"))
      AND (cardinality(s."categories") = 0 OR (${category}::text IS NOT NULL AND ${category}::text::"MarketCategory" = ANY(s."categories")))
    ON CONFLICT ("eventId", "subscriptionId") DO NOTHING`;
}

/** Indexer hook: enqueue when webhooks are enabled, never failing the indexer. */
export async function publishWebhookEvent(
  type: WebhookEventType,
  sourceEventId: string,
  payload: object,
  match: EventMatch,
  db: Db = prisma,
): Promise<void> {
  if (!config.WEBHOOKS_ENABLED) return;
  try {
    await enqueueEvent(db, type, sourceEventId, payload, match);
  } catch (err) {
    logger.error({ err, type, sourceEventId }, 'Webhooks: failed to enqueue event');
  }
}

// ─── Delivery ───────────────────────────────────────────────────────────────

/** Envelope bytes. These exact bytes are signed and sent; never re-serialised. */
export function envelopeBytes(event: { id: string; type: string; createdAt: Date; payload: unknown }): Buffer {
  return canonicalBytes({ id: event.id, type: event.type, createdAt: event.createdAt.toISOString(), data: event.payload });
}

/** Leases up to `limit` due deliveries, at most one (the oldest) per subscription. */
async function claimDueDeliveries(limit = CLAIM_BATCH): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "webhook_deliveries" d
    SET "nextAttemptAt" = now() + make_interval(secs => ${LEASE_SECONDS}), "updatedAt" = now()
    WHERE d."id" IN (
      SELECT c."id" FROM "webhook_deliveries" c
      JOIN "webhook_subscriptions" s ON s."id" = c."subscriptionId" AND s."status" = 'ACTIVE'
      WHERE c."status" = 'PENDING' AND c."nextAttemptAt" <= now()
        AND NOT EXISTS (
          SELECT 1 FROM "webhook_deliveries" p
          WHERE p."subscriptionId" = c."subscriptionId" AND p."status" = 'PENDING' AND p."id" <> c."id"
            AND (p."createdAt", p."id") < (c."createdAt", c."id")
        )
      ORDER BY c."nextAttemptAt"
      LIMIT ${limit}
      FOR UPDATE OF c SKIP LOCKED
    )
    RETURNING d."id"`;
  return rows.map((r) => r.id);
}

export type Sender = typeof safeFetch;

/** Sends one leased delivery and records the outcome. */
export async function deliverOne(deliveryId: string, send: Sender = safeFetch, now = () => new Date()): Promise<void> {
  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { event: true, subscription: true },
  });
  if (!delivery || delivery.status !== 'PENDING' || delivery.subscription.status !== 'ACTIVE') return;
  const { event, subscription: sub } = delivery;

  let statusCode: number | null = null;
  let error: string | null = null;
  let retryAfterMs: number | null = null;
  try {
    const body = envelopeBytes(event);
    const timestamp = Math.floor(now().getTime() / 1000);
    const res = await send(
      sub.url,
      {
        body,
        timeoutMs: DELIVERY_TIMEOUT_MS,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'OracleDesk-Webhooks/1',
          'OracleDesk-Event-Id': event.id,
          'OracleDesk-Event-Type': event.type,
          'OracleDesk-Signature': signatureHeader(signingSecrets(sub, now()), timestamp, body),
        },
      },
      guardOptions(),
    );
    statusCode = res.status;
    if (res.status < 200 || res.status >= 300) {
      error = `HTTP ${res.status}`;
      retryAfterMs = parseRetryAfter(res.headers['retry-after']);
    }
  } catch (err) {
    error = err instanceof SsrfError ? `Blocked: ${err.message}` : err instanceof Error ? err.message : String(err);
  }

  const at = now();
  if (!error) {
    await prisma.$transaction([
      prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: 'SUCCEEDED', attempts: { increment: 1 }, lastStatusCode: statusCode, lastError: null, deliveredAt: at },
      }),
      prisma.webhookSubscription.update({
        where: { id: sub.id },
        data: { consecutiveFailures: 0, failingSince: null },
      }),
    ]);
    return;
  }

  const plan = planFailure(delivery, sub, { now: at, retryAfterMs });
  await prisma.$transaction([
    prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: plan.status, attempts: plan.attempts, nextAttemptAt: plan.nextAttemptAt, lastStatusCode: statusCode, lastError: error.slice(0, 500) },
    }),
    prisma.webhookSubscription.update({
      where: { id: sub.id },
      data: {
        consecutiveFailures: plan.consecutiveFailures,
        failingSince: plan.failingSince,
        ...(plan.disableReason ? { status: 'DISABLED' as const, disabledReason: plan.disableReason } : {}),
      },
    }),
  ]);
  if (plan.status === 'DEAD') {
    logger.warn({ deliveryId: delivery.id, subscriptionId: sub.id, attempts: plan.attempts }, 'Webhooks: delivery dead-lettered');
  }
  if (plan.disableReason) {
    logger.warn({ subscriptionId: sub.id, userId: sub.userId, reason: plan.disableReason }, 'Webhooks: subscription disabled');
  }
}

/** Deletes delivered/dead deliveries and orphaned events past retention. */
export async function pruneOldDeliveries(days = RETENTION_DAYS): Promise<void> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60_000);
  const { count } = await prisma.webhookDelivery.deleteMany({
    where: { status: { in: ['SUCCEEDED', 'DEAD'] }, updatedAt: { lt: cutoff } },
  });
  await prisma.webhookEvent.deleteMany({ where: { createdAt: { lt: cutoff }, deliveries: { none: {} } } });
  if (count > 0) logger.info({ count, days }, 'Webhooks: pruned old deliveries');
}

/** Starts the delivery loop. Returns a stop function. */
export function startWebhookWorker(): () => void {
  if (!config.WEBHOOKS_ENABLED) {
    logger.warn('WEBHOOKS_ENABLED=false; webhook delivery worker disabled');
    return () => undefined;
  }
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  const tick = async () => {
    try {
      const ids = await claimDueDeliveries();
      await Promise.all(
        ids.map((id) => deliverOne(id).catch((err) => logger.error({ err, deliveryId: id }, 'Webhooks: delivery failed unexpectedly'))),
      );
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : err }, 'Webhooks: worker tick failed; will retry');
    }
    if (!stopped) timer = setTimeout(tick, WORKER_INTERVAL_MS);
  };
  const prune = setInterval(() => {
    pruneOldDeliveries().catch((err) => logger.warn({ err }, 'Webhooks: prune failed'));
  }, 24 * 60 * 60_000);
  prune.unref();
  void tick();
  logger.info({ intervalMs: WORKER_INTERVAL_MS }, 'Webhook delivery worker started');
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    clearInterval(prune);
  };
}
