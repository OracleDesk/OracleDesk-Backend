/**
 * Guardian (#92) and operational (#226) alerts.
 *
 * Sinks are pluggable (AlertSink). Two ship: a generic JSON webhook, signed
 * with HMAC-SHA256 so the receiver can verify the sender, and a
 * Slack-compatible incoming webhook. Email can be added as another sink.
 *
 * Two payloads share the sinks: dispute alerts (DisputeAlert, unchanged
 * since #92, `type: oracledesk.dispute_alert`) and operational incidents
 * (OpsAlert, `type: oracledesk.ops_alert`).
 *
 * Delivery is deduplicated by AlertDelivery.dedupeKey, stored in Postgres, so
 * a restart or a second instance never re-sends an alert that already went
 * out. Disputes key on reviewId:level:sink; incidents on
 * inc:<incidentId>:<episode>:<kind>:<severity>:<sink>. A failed delivery is
 * retried with backoff and, if it still fails, left FAILED so the next pass
 * tries again.
 *
 * Webhook URLs carry tokens. They are never logged, never put in an error
 * message and never stored: a sink is identified by a short hash of its URL.
 */
import crypto from 'node:crypto';
import axios from 'axios';
import { config } from '../config';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

export type AlertLevel = 'INFO' | 'WARN' | 'CRITICAL';

/** A dispute review alert (#92). Its serialised form must not change. */
export interface DisputeAlert {
  kind?: undefined;
  level: AlertLevel;
  title: string;
  marketId: string;
  onChainMarketId: string;
  proposedOutcome: string;
  verdict: string;
  /** Seconds of dispute window left on the ledger clock; null when unknown. */
  windowRemainingSecs: number | null;
  links: { market: string; cancelTx: string };
  /** Free-text detail for humans: why this level, what to do. */
  detail?: string;
}

export type OpsNotificationKind = 'open' | 'escalate' | 'resolve';

/** An operational incident notification (#226). */
export interface OpsAlert {
  kind: 'ops';
  /** Same as severity, so sinks written for dispute alerts can read `level`. */
  level: AlertLevel;
  severity: AlertLevel;
  subjectType: string;
  subjectKey: string;
  summary: string;
  detail?: Record<string, unknown> | null;
  state: 'OPEN' | 'RESOLVED';
  incidentId: string;
  episode: number;
  notification: OpsNotificationKind;
  /** Admin API link for the incident (list + ack/silence). */
  adminUrl: string;
}

export type Alert = DisputeAlert | OpsAlert;

export const isOpsAlert = (a: Alert): a is OpsAlert => a.kind === 'ops';

export interface AlertSink {
  /** Stable, secret-free identifier; part of the dedupe key. */
  name: string;
  send(alert: Alert): Promise<void>;
}

const SEND_TIMEOUT_MS = 5_000;
export const SIGNATURE_HEADER = 'X-OracleDesk-Signature';

/** A short, non-reversible id for a URL that must stay secret. */
function urlTag(url: string): string {
  return crypto.createHash('sha256').update(url).digest('hex').slice(0, 10);
}

/**
 * Strips everything that could identify the endpoint from an HTTP failure.
 * axios errors carry the request config (including the URL) on the error object.
 */
function safeFailure(err: unknown): string {
  const e = err as { code?: string; response?: { status?: number } } | null;
  if (e?.response?.status) return `HTTP ${e.response.status}`;
  if (e?.code) return String(e.code);
  return 'request failed';
}

export class SinkError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'SinkError';
  }
}

async function post(url: string, body: string, headers: Record<string, string>): Promise<void> {
  try {
    await axios.post(url, body, {
      headers: { 'content-type': 'application/json', ...headers },
      timeout: SEND_TIMEOUT_MS,
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 300,
    });
  } catch (err) {
    throw new SinkError(safeFailure(err));
  }
}

export function sign(secret: string, body: string): string {
  return `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
}

function webhookEventType(alert: Alert): string {
  switch (alert.kind) {
    case 'price_feed':
      return 'oracledesk.price_feed_alert';
    case 'price_verify':
      return 'oracledesk.price_verify_alert';
    case 'fee_budget':
      return 'oracledesk.fee_budget_alert';
    case 'trace_verdict':
      return 'oracledesk.trace_verdict_alert';
    case 'dispute':
    default:
      return 'oracledesk.dispute_alert';
  }
}

export function webhookSink(url: string, secret = config.ALERT_WEBHOOK_SECRET): AlertSink {
  return {
    name: `webhook-${urlTag(url)}`,
    async send(alert) {
      // Dispute bodies are byte-for-byte what #92 sent.
      const body = isOpsAlert(alert)
        ? JSON.stringify({ type: 'oracledesk.ops_alert', sentAt: new Date().toISOString(), alert })
        : JSON.stringify({ type: 'oracledesk.dispute_alert', sentAt: new Date().toISOString(), alert });
      await post(url, body, secret ? { [SIGNATURE_HEADER]: sign(secret, body) } : {});
    },
  };
}

const EMOJI: Record<AlertLevel, string> = { INFO: ':information_source:', WARN: ':warning:', CRITICAL: ':rotating_light:' };

function formatSlackLines(alert: Alert): string[] {
  if (alert.kind === 'price_feed') {
    const minsToClose = Math.max(0, Math.floor(alert.secsToClose / 60));
    return [
      `${EMOJI[alert.level]} *${alert.level}* ${alert.title}`,
      `Market ${alert.onChainMarketId ?? alert.marketId} · feed ${alert.feed.asset} (${alert.feed.reflector}) · severity ${alert.severity} · closes in ${minsToClose} min`,
      alert.reasons.length > 0 ? `Reasons: ${alert.reasons.join(', ')}` : undefined,
      alert.detail,
    ].filter((line): line is string => Boolean(line));
  }
  if (alert.kind === 'price_verify') {
    return [
      `${EMOJI[alert.level]} *${alert.level}* ${alert.title}`,
      `Market ${alert.onChainMarketId} · event ${alert.eventId} · verdict ${alert.verdict}`,
      alert.detail,
    ].filter((line): line is string => Boolean(line));
  }
  if (alert.kind === 'fee_budget') {
    return [
      `${EMOJI[alert.level]} *${alert.level}* ${alert.title}`,
      `Class ${alert.opClass} · p95 charged resource ${alert.p95ChargedResource} / budget ${alert.budget} (${Math.round(alert.utilizationRatio * 100)}%)`,
      alert.detail,
    ].filter((line): line is string => Boolean(line));
  }
  if (alert.kind === 'trace_verdict') {
    return [
      `${EMOJI[alert.level]} *${alert.level}* ${alert.title}`,
      `Trace ${alert.onChainTraceId} (${alert.traceId}) · agent ${alert.agent} · verdict ${alert.verdict}${alert.reason ? ` (${alert.reason})` : ''}${alert.agentPaused ? ' · agents paused' : ''}`,
      alert.detail,
    ].filter((line): line is string => Boolean(line));
  }
  const remaining = alert.windowRemainingSecs === null ? 'unknown' : `${Math.max(0, Math.floor(alert.windowRemainingSecs / 60))} min`;
  return [
    `${EMOJI[alert.level]} *${alert.level}* ${alert.title}`,
    `Market ${alert.onChainMarketId} · proposed ${alert.proposedOutcome} · verdict ${alert.verdict} · window left ${remaining}`,
    alert.detail,
    `Cancel transaction: ${alert.links.cancelTx}`,
  ].filter((line): line is string => Boolean(line));
}

export function slackSink(url: string): AlertSink {
  return {
    name: 'slack',
    async send(alert) {
      if (isOpsAlert(alert)) {
        await post(url, JSON.stringify({ text: slackOpsText(alert) }), {});
        return;
      }
      const remaining = alert.windowRemainingSecs === null ? 'unknown' : `${Math.max(0, Math.floor(alert.windowRemainingSecs / 60))} min`;
      const lines = [
        `${EMOJI[alert.level]} *${alert.level}* ${alert.title}`,
        `Market ${alert.onChainMarketId} · proposed ${alert.proposedOutcome} · verdict ${alert.verdict} · window left ${remaining}`,
        alert.detail,
        `Cancel transaction: ${alert.links.cancelTx}`,
      ].filter(Boolean);
      await post(url, JSON.stringify({ text: lines.join('\n') }), {});
    },
  };
}

const OPS_VERB: Record<OpsNotificationKind, string> = { open: 'OPEN', escalate: 'STILL OPEN (unacknowledged)', resolve: 'RESOLVED' };

function slackOpsText(alert: OpsAlert): string {
  const icon = alert.notification === 'resolve' ? ':white_check_mark:' : EMOJI[alert.severity];
  return [
    `${icon} *${alert.severity}* ${OPS_VERB[alert.notification]} · ${alert.summary}`,
    `Subject ${alert.subjectType} / ${alert.subjectKey} · episode ${alert.episode}`,
    `Acknowledge or silence: ${alert.adminUrl}`,
  ].join('\n');
}

export function sinksFromConfig(): AlertSink[] {
  const sinks: AlertSink[] = config.ALERT_WEBHOOK_URLS.map((url) => webhookSink(url));
  if (config.ALERT_SLACK_WEBHOOK_URL) sinks.push(slackSink(config.ALERT_SLACK_WEBHOOK_URL));
  return sinks;
}

/**
 * Sink names allowed for `severity` by ALERT_ROUTES_JSON. A route entry
 * matches a sink by exact name or by family (`webhook` matches every
 * webhook-<tag>, `slack` the Slack sink). Without a route, WARN and CRITICAL
 * go to every sink and INFO to none.
 */
export function routeSinks(sinks: AlertSink[], severity: AlertLevel, routesJson = config.ALERT_ROUTES_JSON): AlertSink[] {
  if (!routesJson) return severity === 'INFO' ? [] : sinks;
  const routes = JSON.parse(routesJson) as Partial<Record<AlertLevel, string[]>>;
  const allowed = routes[severity] ?? [];
  return sinks.filter((s) => allowed.some((r) => r === s.name || s.name.startsWith(`${r}-`)));
}

export interface AlertServiceOptions {
  sinks?: AlertSink[];
  /** Attempts per sink per call, with exponential backoff between them. */
  attempts?: number;
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const alertDeliveryDb = () =>
  (prisma as unknown as {
    alertDelivery: {
      findMany(args: unknown): Promise<Array<{ sink: string }>>;
      findUnique(args: unknown): Promise<{ status: string; attempts: number } | null>;
      upsert(args: unknown): Promise<unknown>;
    };
  }).alertDelivery;

export class AlertService {
  private readonly sinks: AlertSink[];
  private readonly attempts: number;
  private readonly backoffMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: AlertServiceOptions = {}) {
    this.sinks = opts.sinks ?? sinksFromConfig();
    this.attempts = opts.attempts ?? 3;
    this.backoffMs = opts.backoffMs ?? 500;
    this.sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  get sinkNames(): string[] {
    return this.sinks.map((s) => s.name);
  }

  /** True when `level` for `subjectId` was already delivered by every sink. */
  async delivered(subjectId: string, level: AlertLevel): Promise<boolean> {
    if (this.sinks.length === 0) return false;
    const rows = await alertDeliveryDb().findMany({ where: { subjectId, level, status: 'SENT' } });
    const sent = new Set(rows.map((r) => r.sink));
    return this.sinks.every((s) => sent.has(s.name));
  }

  /**
   * Sends a dispute `alert` through every sink that has not delivered it yet.
   * Returns the sink names it newly delivered to.
   */
  async send(reviewId: string, alert: DisputeAlert): Promise<string[]> {
    if (this.sinks.length === 0) {
      logger.warn({ subjectId, kind, level: alert.level, title: alert.title }, 'Alert not delivered: no alert sinks configured');
      return [];
    }
    return this.deliver(
      this.sinks,
      (sink) => `${reviewId}:${alert.level}:${sink.name}`,
      alert,
      { reviewId, level: alert.level },
    );
  }

  /**
   * Sends one incident notification (#226) through the sinks routed for its
   * severity. `step` numbers escalations so each one sends exactly once.
   */
  async sendOps(alert: OpsAlert, step = 0): Promise<string[]> {
    const sinks = routeSinks(this.sinks, alert.severity);
    if (sinks.length === 0) return [];
    const kindKey = alert.notification === 'escalate' ? `escalate-${step}` : alert.notification;
    return this.deliver(
      sinks,
      (sink) => `inc:${alert.incidentId}:${alert.episode}:${kindKey}:${alert.severity}:${sink.name}`,
      alert,
      { incidentId: alert.incidentId, kind: alert.notification, level: alert.severity },
    );
  }

  /** Per-sink retry and dedupe loop shared by both payloads. */
  private async deliver(
    sinks: AlertSink[],
    dedupeKeyFor: (sink: AlertSink) => string,
    alert: Alert,
    meta: { reviewId?: string; incidentId?: string; kind?: OpsNotificationKind; level: AlertLevel },
  ): Promise<string[]> {
    const delivered: string[] = [];
    for (const sink of sinks) {
      const dedupeKey = dedupeKeyFor(sink);
      const existing = await prisma.alertDelivery.findUnique({ where: { dedupeKey } });
      if (existing?.status === 'SENT') continue;

      let attempts = existing?.attempts ?? 0;
      let failure: string | null = null;
      for (let i = 0; i < this.attempts; i++) {
        attempts += 1;
        try {
          await sink.send(alert);
          failure = null;
          break;
        } catch (err) {
          failure = err instanceof SinkError ? err.reason : 'request failed';
          if (i < this.attempts - 1) await this.sleep(this.backoffMs * 2 ** i);
        }
      }

      const data = failure === null
        ? { status: 'SENT', attempts, sentAt: new Date(), error: null }
        : { status: 'FAILED', attempts, error: failure };
      const ids = meta.incidentId
        ? { incidentId: meta.incidentId, kind: meta.kind ?? 'open' }
        : { reviewId: meta.reviewId };
      await prisma.alertDelivery.upsert({
        where: { dedupeKey },
        create: { ...ids, level: meta.level, sink: sink.name, dedupeKey, ...data },
        update: data,
      });
      if (failure === null) delivered.push(sink.name);
      else logger.warn({ ...ids, level: meta.level, sink: sink.name, reason: failure }, meta.incidentId ? 'Ops alert delivery failed' : 'Dispute alert delivery failed');
    }
    return delivered;
  }
}
