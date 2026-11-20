/**
 * Cross-source corroboration gate (#228): the I/O around the pure
 * checkCorroboration policy in llm-guard.service.ts.
 *
 * Candidates come from the signal store over CORROBORATION_WINDOW_HOURS,
 * which is deliberately wider than the aggregator's 24 h so earlier coverage
 * of the same story counts. One store read per cycle; the result is cached
 * for the cycle's clock instant.
 */
import { config } from '../config';
import { now as clockNow } from '../lib/clock';
import { sha256Hex } from '../utils/hash.util';
import type { AggregatedSignal, MarketProposal, WeightedSignal } from '../types';
import {
  checkCorroboration,
  sanitizeSignalText,
  MAX_TITLE_CHARS,
  type CorroborationCandidate,
  type CorroborationPolicy,
  type CorroborationVerdict,
} from './llm-guard.service';
import { getSignalStore } from './signal-store.service';
import { meetingAt, type QuestionResolutionBlock } from './resolvability.service';
import { relevanceScore } from './signal-normalize';

export type CorroborationMode = 'off' | 'observe' | 'enforce';

/** What is stored in Market.corroboration. */
export interface CorroborationRecord {
  kind: CorroborationVerdict['kind'];
  corroborators: CorroborationVerdict['corroborators'];
  policy: CorroborationPolicy & { mode: CorroborationMode };
  checkedAt: string;
}

/** What the creation trace carries (TraceDocV2.corroboration). */
export interface TraceCorroboration {
  kind: CorroborationVerdict['kind'];
  units: number;
  domains: string[];
}

export interface CorroborationAssessment {
  verdict: CorroborationVerdict;
  record: CorroborationRecord;
  /** Store rows behind the corroborators, for the trace's sourcesUsed. */
  evidence: WeightedSignal[];
}

export function corroborationPolicy(): CorroborationPolicy {
  return {
    minPublishers: config.CORROBORATION_MIN_PUBLISHERS,
    windowHours: config.CORROBORATION_WINDOW_HOURS,
    simhashRewrite: config.CORROBORATION_SIMHASH_REWRITE,
  };
}

const cache = new Map<string, Promise<CorroborationCandidate[]>>();
const CACHE_MAX = 8;

/** Newest first, at most CORROBORATION_MAX_CANDIDATES, one read per (cycle) instant. */
function loadCandidates(since: Date): Promise<CorroborationCandidate[]> {
  const key = String(since.getTime());
  const hit = cache.get(key);
  if (hit) return hit;
  const pending = getSignalStore()
    .recent(since)
    .then((rows) =>
      [...rows]
        .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime() || (a.id < b.id ? -1 : 1))
        .slice(0, config.CORROBORATION_MAX_CANDIDATES),
    );
  pending.catch(() => cache.delete(key));
  cache.set(key, pending);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  return pending;
}

/** Test seam: forget cached candidate reads. */
export function resetCorroborationCache(): void {
  cache.clear();
}

export async function assessCorroboration(
  proposal: Pick<MarketProposal, 'market_question' | 'category'>,
  groundingSignals: AggregatedSignal[],
  resolution: Pick<QuestionResolutionBlock, 'sourceId' | 'deadlineUtc'> | null,
  now: Date = clockNow(),
): Promise<CorroborationAssessment> {
  const policy = corroborationPolicy();
  const since = new Date(now.getTime() - policy.windowHours * 3_600_000);
  const candidates = await loadCandidates(since);
  // The question is model output: entities come from its sanitised text.
  const question = sanitizeSignalText(proposal.market_question, MAX_TITLE_CHARS).text;
  const resolutionSourceId = resolution?.sourceId ?? null;
  const meeting = resolution ? meetingAt(new Date(resolution.deadlineUtc), resolutionSourceId) : null;

  const verdict = checkCorroboration({
    question,
    category: String(proposal.category),
    grounding: groundingSignals,
    candidates,
    resolutionSourceId,
    meeting,
    now,
  }, policy);

  const rows = new Map(candidates.map((c) => [c.id, c]));
  const evidence: WeightedSignal[] = [];
  for (const ref of verdict.corroborators) {
    const row = rows.get(ref.signalId);
    if (!row) continue; // grounding or FRED refs: already in the grounding evidence
    evidence.push({
      source: row.source,
      weight: relevanceScore(row.source, row.publishedAt, 1, now),
      signal: row.title,
      signalId: row.id,
      ...(row.url ? { url: row.url } : {}),
      publisher: row.publisher,
      publishedAt: row.publishedAt.toISOString(),
    });
  }

  return {
    verdict,
    evidence,
    record: {
      kind: verdict.kind,
      corroborators: verdict.corroborators,
      policy: { ...policy, mode: config.CORROBORATION_MODE },
      checkedAt: now.toISOString(),
    },
  };
}

export function traceCorroboration(v: CorroborationVerdict): TraceCorroboration {
  return {
    kind: v.kind,
    units: Number(v.detail.units ?? 0),
    domains: Array.isArray(v.detail.domains) ? (v.detail.domains as string[]) : [],
  };
}

/** Rejection log data: counts, domains and signal hashes, never signal text. */
export function uncorroboratedLogData(v: CorroborationVerdict, grounding: AggregatedSignal[]): Record<string, unknown> {
  return {
    units: v.detail.units,
    domains: v.detail.domains,
    matched: v.detail.matched,
    window: { hours: v.detail.windowHours, minPublishers: v.detail.minPublishers },
    signalHashes: grounding.map((s) => sha256Hex(s.signalId)).sort(),
    corroboratorHashes: v.corroborators.map((c) => sha256Hex(c.signalId)).sort(),
  };
}
