/**
 * Per-signal-source circuit breaker (#277). Shared via Redis when available;
 * falls back to a process-local breaker (never fail-open to always fetch).
 */
import { config } from '../config';
import { logger } from '../lib/logger';
import { getRedis } from './redis';
import { nowMs } from './clock';
import type { SignalSource } from '../services/signal-normalize';
import { AlertService } from '../services/alerts.service';
import type { OpsAlert } from '../services/alerts.service';

export type SourceBreakerState = 'closed' | 'open' | 'half-open';

export interface SourceBreakerSnapshot {
  state: SourceBreakerState;
  openedAt: number | null;
  consecutiveFailures: number;
  probeLeaseUntil: number | null;
  cooldownMs: number;
}

export type SourceFetchOutcome = 'ok' | 'error' | 'timeout' | 'partial';

export interface SourceBreakerDecision {
  fetch: boolean;
  recordSkip: boolean;
  probe: boolean;
}

interface BreakerRecord {
  state: SourceBreakerState;
  openedAt: number;
  consecutiveFailures: number;
  probeLeaseUntil: number;
  cooldownMs: number;
}

const MAX_COOLDOWN_MS = 3_600_000;
const PROBE_LEASE_MS = 30_000;
const redisKey = (source: SignalSource) => `source-breaker:${source}`;

class LocalSourceBreaker {
  private readonly records = new Map<SignalSource, BreakerRecord>();

  private rec(source: SignalSource): BreakerRecord {
    let r = this.records.get(source);
    if (!r) {
      r = { state: 'closed', openedAt: 0, consecutiveFailures: 0, probeLeaseUntil: 0, cooldownMs: config.SIGNAL_BREAKER_COOLDOWN_MS };
      this.records.set(source, r);
    }
    return r;
  }

  decide(source: SignalSource, now: number): SourceBreakerDecision {
    const r = this.rec(source);
    if (r.state === 'open') {
      if (now < r.openedAt + r.cooldownMs) {
        return { fetch: false, recordSkip: true, probe: false };
      }
      if (now < r.probeLeaseUntil) {
        return { fetch: false, recordSkip: false, probe: false };
      }
      r.state = 'half-open';
      r.probeLeaseUntil = now + PROBE_LEASE_MS;
      return { fetch: true, recordSkip: false, probe: true };
    }
    if (r.state === 'half-open') {
      if (now < r.probeLeaseUntil) {
        return { fetch: false, recordSkip: false, probe: false };
      }
      r.probeLeaseUntil = now + PROBE_LEASE_MS;
      return { fetch: true, recordSkip: false, probe: true };
    }
    return { fetch: true, recordSkip: false, probe: false };
  }

  record(source: SignalSource, outcome: SourceFetchOutcome, now: number): SourceBreakerSnapshot {
    const r = this.rec(source);
    const failure = outcome === 'error' || outcome === 'timeout' || outcome === 'partial';
    if (!failure) {
      if (r.state !== 'closed') void notifyBreakerTransition(source, 'closed');
      r.state = 'closed';
      r.consecutiveFailures = 0;
      r.openedAt = 0;
      r.probeLeaseUntil = 0;
      r.cooldownMs = config.SIGNAL_BREAKER_COOLDOWN_MS;
      return this.snapshot(source, r);
    }
    r.consecutiveFailures += 1;
    if (r.state === 'half-open' || r.consecutiveFailures >= config.SIGNAL_BREAKER_FAILURES) {
      const prev = r.state;
      r.state = 'open';
      r.openedAt = now;
      r.cooldownMs = Math.min(MAX_COOLDOWN_MS, Math.max(config.SIGNAL_BREAKER_COOLDOWN_MS, r.cooldownMs * 2));
      r.probeLeaseUntil = 0;
      if (prev !== 'open') void notifyBreakerTransition(source, 'open');
    }
    return this.snapshot(source, r);
  }

  tripLowOkRate(source: SignalSource, now: number): void {
    const r = this.rec(source);
    if (r.state === 'open') return;
    r.state = 'open';
    r.openedAt = now;
    r.cooldownMs = config.SIGNAL_BREAKER_COOLDOWN_MS;
    r.probeLeaseUntil = 0;
    void notifyBreakerTransition(source, 'open');
  }

  snapshot(source: SignalSource, r = this.rec(source)): SourceBreakerSnapshot {
    return {
      state: r.state,
      openedAt: r.openedAt || null,
      consecutiveFailures: r.consecutiveFailures,
      probeLeaseUntil: r.probeLeaseUntil || null,
      cooldownMs: r.cooldownMs,
    };
  }
}

const local = new LocalSourceBreaker();
let alerts: AlertService | null = null;

function getAlerts(): AlertService {
  alerts ??= new AlertService();
  return alerts;
}

async function notifyBreakerTransition(source: SignalSource, state: 'open' | 'closed'): Promise<void> {
  const alert: OpsAlert = {
    kind: 'ops',
    level: 'WARN',
    severity: 'WARN',
    subjectType: 'signal_source_breaker',
    subjectKey: source,
    summary: `Signal source ${source} breaker ${state}`,
    detail: { source, state },
    state: state === 'closed' ? 'RESOLVED' : 'OPEN',
    incidentId: `signal-breaker-${source}`,
    episode: 1,
    notification: state === 'closed' ? 'resolve' : 'open',
    adminUrl: '/api/v1/admin/signals/health',
  };
  try {
    await getAlerts().sendOps(alert, 0);
  } catch (err) {
    logger.warn({ err, source, state }, 'Signal breaker alert failed');
  }
}

async function redisHgetall(source: SignalSource): Promise<Record<string, string> | null> {
  try {
    const r = getRedis();
    return await r.hgetall(redisKey(source));
  } catch {
    return null;
  }
}

export async function sourceBreakerDecide(source: SignalSource): Promise<SourceBreakerDecision> {
  const now = nowMs();
  const remote = await redisHgetall(source);
  if (!remote || Object.keys(remote).length === 0) {
    return local.decide(source, now);
  }
  const state = (remote.state as SourceBreakerState) ?? 'closed';
  const openedAt = Number(remote.openedAt ?? 0);
  const cooldownMs = Number(remote.cooldownMs ?? config.SIGNAL_BREAKER_COOLDOWN_MS);
  const probeUntil = Number(remote.probeLeaseUntil ?? 0);
  if (state === 'open' && now < openedAt + cooldownMs) {
    return { fetch: false, recordSkip: true, probe: false };
  }
  if (state === 'open' || state === 'half-open') {
    try {
      const r = getRedis();
      const lease = await r.set(`source-breaker-probe:${source}`, '1', 'PX', PROBE_LEASE_MS, 'NX');
      if (lease !== 'OK') return { fetch: false, recordSkip: false, probe: false };
      await r.hset(redisKey(source), 'state', 'half-open', 'probeLeaseUntil', String(now + PROBE_LEASE_MS));
      return { fetch: true, recordSkip: false, probe: true };
    } catch {
      return local.decide(source, now);
    }
  }
  return { fetch: true, recordSkip: false, probe: false };
}

export async function sourceBreakerRecord(source: SignalSource, outcome: SourceFetchOutcome): Promise<SourceBreakerSnapshot> {
  const now = nowMs();
  const snap = local.record(source, outcome, now);
  try {
    const r = getRedis();
    await r.hset(redisKey(source), {
      state: snap.state,
      openedAt: String(snap.openedAt ?? 0),
      consecutiveFailures: String(snap.consecutiveFailures),
      probeLeaseUntil: String(snap.probeLeaseUntil ?? 0),
      cooldownMs: String(snap.cooldownMs),
    });
  } catch {
    /* local already updated */
  }
  return snap;
}

export async function sourceBreakerTripLowOkRate(source: SignalSource): Promise<void> {
  const now = nowMs();
  local.tripLowOkRate(source, now);
  try {
    const r = getRedis();
    await r.hset(redisKey(source), {
      state: 'open',
      openedAt: String(now),
      cooldownMs: String(config.SIGNAL_BREAKER_COOLDOWN_MS),
      probeLeaseUntil: '0',
    });
  } catch {
    /* noop */
  }
}

export async function sourceBreakerSnapshots(): Promise<Record<SignalSource, SourceBreakerSnapshot>> {
  const sources: SignalSource[] = ['NEWSAPI', 'FRED', 'GDELT'];
  const out = {} as Record<SignalSource, SourceBreakerSnapshot>;
  for (const s of sources) {
    const remote = await redisHgetall(s);
    if (remote && Object.keys(remote).length > 0) {
      out[s] = {
        state: (remote.state as SourceBreakerState) ?? 'closed',
        openedAt: Number(remote.openedAt) || null,
        consecutiveFailures: Number(remote.consecutiveFailures ?? 0),
        probeLeaseUntil: Number(remote.probeLeaseUntil) || null,
        cooldownMs: Number(remote.cooldownMs ?? config.SIGNAL_BREAKER_COOLDOWN_MS),
      };
    } else {
      out[s] = local.snapshot(s);
    }
  }
  return out;
}

/** Test seam. */
export function resetSourceBreakersForTest(): void {
  (local as any).records?.clear?.();
  alerts = null;
}