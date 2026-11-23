/**
 * Output-side citation validator for forecast and trace hedge outputs (#304).
 *
 * Pure and side-effect free: checks every cited signal id, URL/domain,
 * quoted phrase, and structured FRED numeric claim against the exact set of
 * sanitized signals rendered into the prompt. Provides deterministic
 * remediation (strip invalid adjustments, redact unverifiable spans, reject
 * samples above threshold) without extra LLM calls.
 */
import { config } from '../config';
import type { CitationCheckProvenance } from '../lib/llm/provenance';
import type { TraceReasoningOutput } from '../lib/llm-schema';
import { URLISH_RE } from './llm-guard.service';
import { canonicalUrl, jaccard, normalizeText, shingles } from './signal-normalize';

export interface CitationSource {
  promptId: string;
  signalId: string | null;
  source: string;
  title: string;
  url: string | null;
  numeric?: { seriesId: string; value: number };
}

export type CitationIssue =
  | { code: 'UNKNOWN_ID'; where: string; id: string }
  | { code: 'QUARANTINED_ID'; where: string; id: string }
  | { code: 'UNSOURCED_URL'; where: string; host: string }
  | { code: 'UNVERIFIED_QUOTE'; where: string; quote: string; best: number }
  | { code: 'NUMERIC_MISMATCH'; where: string; seriesId: string; claimed: number; actual: number };

export interface CitationReport {
  version: 1;
  checked: number;
  issues: CitationIssue[];
  invalidFraction: number;
}

export interface ForecastOutputLike {
  base_rate: number;
  adjustments: Array<{ signal_id: string; delta: number; why: string }>;
  p: number;
  p_low_50: number;
  p_high_50: number;
  rationale: string;
}

export interface RejectedAdjustment {
  signal_id: string;
  delta: number;
  why: string;
  reasons: string[];
}

export interface ForecastRemediationResult<T extends ForecastOutputLike = ForecastOutputLike> {
  accepted: boolean;
  action: 'ACCEPTED' | 'STRIPPED' | 'REJECTED';
  report: CitationReport;
  sanitized: T;
  rejectedAdjustments: RejectedAdjustment[];
  citedSignalIds: string[];
  summary: CitationCheckProvenance;
}

export interface HedgeRemediationResult {
  conditions: string[];
  action: 'ACCEPTED' | 'STRIPPED' | 'REJECTED';
  report: CitationReport;
  summary: CitationCheckProvenance;
}

// ─── Patterns & Helpers ─────────────────────────────────────────────────────

const PROMPT_ID_RE = /\bs\d{1,2}\b/g;
const QUOTE_RE = /(?:"([^"\n]{1,400})"|\u201c([^\u201d\n]{1,400})\u201d)/g;
const URL_OR_DOMAIN_EXTRACT_RE =
  /https?:\/\/[^\s<>()[\]"'\u201c\u201d,;]+|\bwww\.[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s<>()[\]"'\u201c\u201d,;]*)?|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|io|xyz|info|example)(?:\/[^\s<>()[\]"'\u201c\u201d,;]*)?/gi;
const FRED_TITLE_RE = /^([A-Z][A-Z0-9_]{1,31})\s*:\s*(-?\d+(?:\.\d+)?)\b/;

const FRED_SERIES_ALIASES: Record<string, string[]> = {
  CPIAUCSL: ['cpi', 'inflation'],
  CPILFESL: ['core cpi', 'cpi'],
  FEDFUNDS: ['fed funds', 'fedfunds', 'federal funds'],
  DFF: ['dff', 'fed funds', 'federal funds'],
  UNRATE: ['unrate', 'unemployment'],
  GDP: ['gdp'],
  GDPC1: ['gdp', 'real gdp'],
  PCEPI: ['pce', 'pcepi'],
  PCEPILFE: ['core pce', 'pce'],
  DGS10: ['10y', 'dgs10', 'treasury'],
  DGS2: ['2y', 'dgs2', 'treasury'],
  PAYEMS: ['payems', 'payrolls', 'nonfarm'],
};

/** Parses `{ seriesId, value }` from a FRED signal title (`SERIES: 3.2`), if present. */
export function parseFredNumeric(
  source: string,
  title: string,
): { seriesId: string; value: number } | undefined {
  if (source.toUpperCase() !== 'FRED') return undefined;
  const match = FRED_TITLE_RE.exec(title.trim());
  if (!match) return undefined;
  const value = Number(match[2]);
  if (!Number.isFinite(value)) return undefined;
  return { seriesId: match[1].toUpperCase(), value };
}

function hostOf(raw: string): string | null {
  const trimmed = raw.replace(/[.)\],;:!?]+$/, '');
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const canonical = canonicalUrl(withScheme);
  if (!canonical) return null;
  try {
    return new URL(canonical).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function allowedHostsFor(sent: CitationSource[]): Set<string> {
  const hosts = new Set<string>();
  for (const s of sent) {
    if (!s.url) continue;
    const h = hostOf(s.url);
    if (h) hosts.add(h);
  }
  return hosts;
}

function extractUrls(text: string): Array<{ raw: string; host: string; start: number; end: number }> {
  const out: Array<{ raw: string; host: string; start: number; end: number }> = [];
  if (!URLISH_RE.test(text)) return out;
  URL_OR_DOMAIN_EXTRACT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_OR_DOMAIN_EXTRACT_RE.exec(text)) !== null) {
    const raw = m[0];
    if (!URLISH_RE.test(raw)) continue;
    const host = hostOf(raw);
    if (!host) continue;
    out.push({ raw, host, start: m.index, end: m.index + raw.length });
  }
  return out;
}

function isContiguousSubsequence(needle: string[], haystack: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

function bestQuoteScore(quote: string, sent: CitationSource[]): number {
  const quoteTokens = normalizeText(quote);
  if (quoteTokens.length === 0) return 0;
  const quoteShingles = shingles(quote);
  let best = 0;
  for (const s of sent) {
    const titleTokens = normalizeText(s.title);
    if (isContiguousSubsequence(quoteTokens, titleTokens)) {
      return 1;
    }
    const score = jaccard(quoteShingles, shingles(s.title));
    if (score > best) best = score;
  }
  return Math.round(best * 1000) / 1000;
}

function extractQuotes(text: string): Array<{ full: string; inner: string; words: number; start: number; end: number }> {
  const out: Array<{ full: string; inner: string; words: number; start: number; end: number }> = [];
  QUOTE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = QUOTE_RE.exec(text)) !== null) {
    const inner = (m[1] ?? m[2] ?? '').trim();
    const words = inner.split(/\s+/).filter(Boolean).length;
    if (words >= 4 && words <= 40) {
      out.push({ full: m[0], inner, words, start: m.index, end: m.index + m[0].length });
    }
  }
  return out;
}

function fredAliasesFor(seriesId: string): string[] {
  const upper = seriesId.toUpperCase();
  const base = upper.toLowerCase();
  const aliases = new Set<string>([base]);
  const mapped = FRED_SERIES_ALIASES[upper];
  if (mapped) {
    for (const a of mapped) aliases.add(a);
  }
  const alphaPrefix = upper.match(/^[A-Z]{3,}/)?.[0]?.toLowerCase();
  if (alphaPrefix && alphaPrefix !== base) aliases.add(alphaPrefix);
  return [...aliases];
}

function parseNumericToken(token: string): { value: number; isBps: boolean } | null {
  const cleaned = token.replace(/^[(["'\u201c]+|[)\]"'\u201d.,;:!?]+$/g, '');
  const m = /^(-?\d+(?:\.\d+)?)(%|bps|bp)?$/i.exec(cleaned);
  if (!m) return null;
  const raw = Number(m[1]);
  if (!Number.isFinite(raw)) return null;
  const suffix = (m[2] ?? '').toLowerCase();
  if (suffix === 'bps' || suffix === 'bp') {
    return { value: raw / 100, isBps: true };
  }
  return { value: raw, isBps: false };
}

function checkFredNumbers(
  text: string,
  where: string,
  fredSources: CitationSource[],
  issues: CitationIssue[],
): number {
  if (fredSources.length === 0) return 0;
  const rawTokens = text.split(/\s+/).filter(Boolean);
  const lowerTokens = rawTokens.map((t) => t.toLowerCase().replace(/[^a-z0-9_.-]/g, ''));
  let checked = 0;

  for (const src of fredSources) {
    if (!src.numeric) continue;
    const { seriesId, value: actual } = src.numeric;
    const aliases = fredAliasesFor(seriesId);
    const anchorIndices = new Set<number>();

    for (let i = 0; i < lowerTokens.length; i++) {
      const tok = lowerTokens[i];
      const pair = i + 1 < lowerTokens.length ? `${tok} ${lowerTokens[i + 1]}` : '';
      if (tok === src.promptId.toLowerCase() || aliases.includes(tok) || (pair && aliases.includes(pair))) {
        anchorIndices.add(i);
      }
    }

    if (anchorIndices.size === 0) continue;

    const inspectedTokenPositions = new Set<number>();
    for (const anchor of anchorIndices) {
      const lo = Math.max(0, anchor - 8);
      const hi = Math.min(rawTokens.length - 1, anchor + 8);
      for (let j = lo; j <= hi; j++) {
        if (j === anchor || inspectedTokenPositions.has(j)) continue;
        // Skip signal ids (s1..s99) and bare 4-digit calendar years (1900..2100).
        if (/^s\d{1,2}$/i.test(lowerTokens[j])) continue;
        const parsed = parseNumericToken(rawTokens[j]);
        if (!parsed) continue;
        if (!parsed.isBps && Number.isInteger(parsed.value) && parsed.value >= 1900 && parsed.value <= 2100) continue;
        inspectedTokenPositions.add(j);
        checked++;
        const tol = Math.max(0.01, 0.01 * Math.abs(actual));
        if (Math.abs(parsed.value - actual) > tol) {
          issues.push({
            code: 'NUMERIC_MISMATCH',
            where,
            seriesId,
            claimed: parsed.value,
            actual,
          });
        }
      }
    }
  }

  return checked;
}

function checkTextField(
  text: string,
  where: string,
  sent: CitationSource[],
  sentIds: Set<string>,
  quarantinedIds: Set<string>,
  allowedHosts: Set<string>,
  minQuoteJaccard: number,
  issues: CitationIssue[],
): number {
  let checked = 0;

  // 1. Inline signal ids (s1..s99)
  PROMPT_ID_RE.lastIndex = 0;
  let idMatch: RegExpExecArray | null;
  while ((idMatch = PROMPT_ID_RE.exec(text)) !== null) {
    const id = idMatch[0];
    checked++;
    if (quarantinedIds.has(id)) {
      issues.push({ code: 'QUARANTINED_ID', where, id });
    } else if (!sentIds.has(id)) {
      issues.push({ code: 'UNKNOWN_ID', where, id });
    }
  }

  // 2. URLs and bare domains
  for (const u of extractUrls(text)) {
    checked++;
    if (!allowedHosts.has(u.host)) {
      issues.push({ code: 'UNSOURCED_URL', where, host: u.host });
    }
  }

  // 3. Double-quoted spans (4-40 words)
  for (const q of extractQuotes(text)) {
    checked++;
    const best = bestQuoteScore(q.inner, sent);
    if (best < minQuoteJaccard) {
      issues.push({ code: 'UNVERIFIED_QUOTE', where, quote: q.inner, best });
    }
  }

  return checked;
}

// ─── Public Validators ──────────────────────────────────────────────────────

export function validateForecastCitations(
  out: ForecastOutputLike,
  sent: CitationSource[],
  quarantined: string[],
  opts?: { minQuoteJaccard?: number },
): CitationReport {
  const minQuoteJaccard = opts?.minQuoteJaccard ?? config.CITATION_QUOTE_MIN_JACCARD;
  const sentIds = new Set(sent.map((s) => s.promptId));
  const quarantinedIds = new Set(quarantined);
  const allowedHosts = allowedHostsFor(sent);
  const sentById = new Map(sent.map((s) => [s.promptId, s]));
  const fredSources = sent.filter((s) => s.numeric !== undefined);
  const issues: CitationIssue[] = [];
  let checked = 0;

  const citedFredSet = new Set<CitationSource>();

  for (let i = 0; i < out.adjustments.length; i++) {
    const adj = out.adjustments[i];
    const id = adj.signal_id;
    checked++;
    if (quarantinedIds.has(id)) {
      issues.push({ code: 'QUARANTINED_ID', where: `adjustments[${i}].signal_id`, id });
    } else if (!sentIds.has(id)) {
      issues.push({ code: 'UNKNOWN_ID', where: `adjustments[${i}].signal_id`, id });
    } else {
      const src = sentById.get(id);
      if (src?.numeric) citedFredSet.add(src);
    }

    checked += checkTextField(
      adj.why,
      `adjustments[${i}].why`,
      sent,
      sentIds,
      quarantinedIds,
      allowedHosts,
      minQuoteJaccard,
      issues,
    );
    const adjFred = sentById.get(id)?.numeric ? [sentById.get(id)!] : fredSources;
    checked += checkFredNumbers(adj.why, `adjustments[${i}].why`, adjFred, issues);
  }

  checked += checkTextField(
    out.rationale,
    'rationale',
    sent,
    sentIds,
    quarantinedIds,
    allowedHosts,
    minQuoteJaccard,
    issues,
  );
  const rationaleFred = citedFredSet.size > 0 ? [...citedFredSet] : fredSources;
  checked += checkFredNumbers(out.rationale, 'rationale', rationaleFred, issues);

  const invalidFraction = checked > 0 ? Math.min(1, Math.round((issues.length / checked) * 10_000) / 10_000) : 0;
  return { version: 1, checked, issues, invalidFraction };
}

export function validateHedgeCitations(
  out: TraceReasoningOutput,
  sent: CitationSource[],
  quarantined: string[] = [],
  opts?: { minQuoteJaccard?: number },
): CitationReport {
  const minQuoteJaccard = opts?.minQuoteJaccard ?? config.CITATION_QUOTE_MIN_JACCARD;
  const sentIds = new Set(sent.map((s) => s.promptId));
  const quarantinedIds = new Set(quarantined);
  const allowedHosts = allowedHostsFor(sent);
  const issues: CitationIssue[] = [];
  let checked = 0;

  for (let i = 0; i < (out.hedge_conditions ?? []).length; i++) {
    checked += checkTextField(
      out.hedge_conditions[i],
      `hedge_conditions[${i}]`,
      sent,
      sentIds,
      quarantinedIds,
      allowedHosts,
      minQuoteJaccard,
      issues,
    );
  }
  if (out.reasoning_summary) {
    checked += checkTextField(
      out.reasoning_summary,
      'reasoning_summary',
      sent,
      sentIds,
      quarantinedIds,
      allowedHosts,
      minQuoteJaccard,
      issues,
    );
  }

  const invalidFraction = checked > 0 ? Math.min(1, Math.round((issues.length / checked) * 10_000) / 10_000) : 0;
  return { version: 1, checked, issues, invalidFraction };
}

// ─── Deterministic Remediation ──────────────────────────────────────────────

export function countIssueCodes(issues: CitationIssue[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const issue of issues) {
    counts[issue.code] = (counts[issue.code] ?? 0) + 1;
  }
  return counts;
}

/** Replaces unverifiable double-quoted phrases and unsourced URLs/domains with `[unverified]`. */
export function redactUnverifiedText(
  text: string,
  sent: CitationSource[],
  opts?: { minQuoteJaccard?: number },
): { text: string; redactedCount: number } {
  const minQuoteJaccard = opts?.minQuoteJaccard ?? config.CITATION_QUOTE_MIN_JACCARD;
  const allowedHosts = allowedHostsFor(sent);
  let result = text;
  let redactedCount = 0;

  // Redact unverified quoted phrases first.
  result = result.replace(QUOTE_RE, (full, g1?: string, g2?: string) => {
    const inner = (g1 ?? g2 ?? '').trim();
    const words = inner.split(/\s+/).filter(Boolean).length;
    if (words < 4 || words > 40) return full;
    if (bestQuoteScore(inner, sent) < minQuoteJaccard) {
      redactedCount++;
      return '[unverified]';
    }
    return full;
  });

  // Redact unsourced URLs / bare domains.
  if (URLISH_RE.test(result)) {
    result = result.replace(URL_OR_DOMAIN_EXTRACT_RE, (raw) => {
      if (!URLISH_RE.test(raw)) return raw;
      const host = hostOf(raw);
      if (host && !allowedHosts.has(host)) {
        redactedCount++;
        return '[unverified]';
      }
      return raw;
    });
  }

  return { text: result, redactedCount };
}

export function remediateForecastSample<T extends ForecastOutputLike>(
  out: T,
  sent: CitationSource[],
  quarantined: string[],
  opts?: { minQuoteJaccard?: number; maxInvalidFraction?: number },
): ForecastRemediationResult<T> {
  const minQuoteJaccard = opts?.minQuoteJaccard ?? config.CITATION_QUOTE_MIN_JACCARD;
  const maxInvalidFraction = opts?.maxInvalidFraction ?? config.CITATION_MAX_INVALID_FRACTION;
  const report = validateForecastCitations(out, sent, quarantined, { minQuoteJaccard });
  const issueCodes = countIssueCodes(report.issues);

  const hasQuarantined = report.issues.some((i) => i.code === 'QUARANTINED_ID');
  const exceedsThreshold = report.invalidFraction > maxInvalidFraction;

  const sentById = new Map(sent.map((s) => [s.promptId, s]));
  const quarantinedSet = new Set(quarantined);
  const keptAdjustments: Array<{ signal_id: string; delta: number; why: string }> = [];
  const rejectedAdjustments: RejectedAdjustment[] = [];
  const citedSet = new Set<string>();
  let totalRedactions = 0;

  for (let i = 0; i < out.adjustments.length; i++) {
    const adj = out.adjustments[i];
    if (quarantinedSet.has(adj.signal_id)) {
      rejectedAdjustments.push({ ...adj, reasons: ['QUARANTINED_ID'] });
      continue;
    }
    const src = sentById.get(adj.signal_id);
    if (!src) {
      rejectedAdjustments.push({ ...adj, reasons: ['UNKNOWN_ID'] });
      continue;
    }
    const { text: cleanWhy, redactedCount } = redactUnverifiedText(adj.why, sent, { minQuoteJaccard });
    totalRedactions += redactedCount;
    keptAdjustments.push({ ...adj, why: cleanWhy });
    if (src.signalId) citedSet.add(src.signalId);
  }

  const { text: cleanRationale, redactedCount: ratRedactions } = redactUnverifiedText(out.rationale, sent, {
    minQuoteJaccard,
  });
  totalRedactions += ratRedactions;

  // Also collect any valid prompt ids referenced in rationale.
  PROMPT_ID_RE.lastIndex = 0;
  let idMatch: RegExpExecArray | null;
  while ((idMatch = PROMPT_ID_RE.exec(cleanRationale)) !== null) {
    const src = sentById.get(idMatch[0]);
    if (src?.signalId) citedSet.add(src.signalId);
  }

  const sanitized: T = {
    ...out,
    adjustments: keptAdjustments,
    rationale: cleanRationale,
  };

  if (hasQuarantined || exceedsThreshold) {
    const summary: CitationCheckProvenance = {
      version: 1,
      checked: report.checked,
      issueCodes,
      action: 'REJECTED',
    };
    return {
      accepted: false,
      action: 'REJECTED',
      report,
      sanitized,
      rejectedAdjustments,
      citedSignalIds: [],
      summary,
    };
  }

  const wasStripped = rejectedAdjustments.length > 0 || totalRedactions > 0 || report.issues.length > 0;
  const action = wasStripped ? 'STRIPPED' : 'ACCEPTED';
  const summary: CitationCheckProvenance = {
    version: 1,
    checked: report.checked,
    issueCodes,
    action,
  };

  return {
    accepted: true,
    action,
    report,
    sanitized,
    rejectedAdjustments,
    citedSignalIds: [...citedSet],
    summary,
  };
}

export function remediateHedgeConditions(
  out: TraceReasoningOutput,
  sent: CitationSource[],
  quarantined: string[] = [],
  opts?: { minQuoteJaccard?: number },
): HedgeRemediationResult {
  const minQuoteJaccard = opts?.minQuoteJaccard ?? config.CITATION_QUOTE_MIN_JACCARD;
  const report = validateHedgeCitations(out, sent, quarantined, { minQuoteJaccard });
  const issueCodes = countIssueCodes(report.issues);

  const sentIds = new Set(sent.map((s) => s.promptId));
  const quarantinedSet = new Set(quarantined);
  const allowedHosts = allowedHostsFor(sent);
  const kept: string[] = [];
  let strippedAny = false;

  for (const cond of out.hedge_conditions ?? []) {
    let invalid = false;

    PROMPT_ID_RE.lastIndex = 0;
    let idMatch: RegExpExecArray | null;
    while ((idMatch = PROMPT_ID_RE.exec(cond)) !== null) {
      if (quarantinedSet.has(idMatch[0]) || !sentIds.has(idMatch[0])) {
        invalid = true;
        break;
      }
    }

    if (!invalid) {
      for (const u of extractUrls(cond)) {
        if (!allowedHosts.has(u.host)) {
          invalid = true;
          break;
        }
      }
    }

    if (invalid) {
      strippedAny = true;
      continue;
    }

    const { text: cleanCond, redactedCount } = redactUnverifiedText(cond, sent, { minQuoteJaccard });
    if (redactedCount > 0) strippedAny = true;
    kept.push(cleanCond);
  }

  if (kept.length < 1) {
    return {
      conditions: [],
      action: 'REJECTED',
      report,
      summary: {
        version: 1,
        checked: report.checked,
        issueCodes,
        action: 'REJECTED',
      },
    };
  }

  const action = strippedAny ? 'STRIPPED' : 'ACCEPTED';
  return {
    conditions: kept,
    action,
    report,
    summary: {
      version: 1,
      checked: report.checked,
      issueCodes,
      action,
    },
  };
}
