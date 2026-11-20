/**
 * Prompt-injection defences for market generation (#70).
 *
 * Headlines, article descriptions, GDELT URLs and previously generated market
 * questions are attacker-controllable text, and what the model returns can
 * move real money (the treasury seeds every accepted proposal). The layers:
 *
 *   1. sanitise at ingestion (sanitizeSignal): Unicode NFKC, control /
 *      zero-width / bidi removal, whitespace collapse, length caps, URLs moved
 *      out of the text, instruction-like text flagged;
 *   2. quarantine flagged signals (partitionSignals): never sent to the model;
 *   3. delimit what is sent (renderUntrustedBlock): one JSON line per signal in
 *      a block with a random nonce, delimiter look-alikes escaped;
 *   4. say so in the system prompt (done by the callers);
 *   5. check the model's answer deterministically (checkProposal): grounded in
 *      signals that were really sent, probability / expiry / oracle / content
 *      policy.
 *
 * Everything here is pure and side-effect free. Logs built from these results
 * carry reason codes and hashes, never the raw attacker text.
 */
import { randomBytes } from 'node:crypto';
import type { AggregatedSignal, MarketProposal, RawSignal } from '../types';
import { ALLOWED_ORACLES, meaningfulTokens } from './market-policy';
import { extractEntities } from './dedup-entities';
import { fingerprintText, hammingDistance, simhash64 } from './signal-normalize';
import { fredSeriesFor, type SourceId } from './resolvability.service';
import type { MeetingDef } from './resolvability.calendar';
import type { SignalRow } from './signal-store.service';
import { publisherDomain } from '../lib/domains';

export interface SanitizedSignal extends RawSignal {
  /** Citable id (n1, f1, m1, e1…) assigned when the signal is sent to a model. */
  id?: string;
  url?: string;
  sanitizedFlags: string[];
}

export type SanitizeFlag = 'stripped_control' | 'had_url' | 'truncated' | 'instruction_like';

export const MAX_TITLE_CHARS = 200;
export const MAX_CONTENT_CHARS = 300;

// Probability policy: extreme prices are the main economic attack, so they are
// rejected rather than clamped.
export const MIN_INITIAL_PROBABILITY = 0.05;
export const MAX_INITIAL_PROBABILITY = 0.95;
export const MIN_EXPIRY_DAYS = 1;
export const MAX_EXPIRY_DAYS = 90;
export const MIN_GROUNDING_TOKEN_OVERLAP = 2;

const URL_RE = /https?:\/\/\S+/gi;

/**
 * Instruction phrasing, not single words: "Markets ignore Fed warning" is a
 * normal headline. Matched after NFKC so full-width look-alikes cannot hide it.
 */
const INSTRUCTION_RE = new RegExp(
  [
    String.raw`\b(?:ignore|disregard|forget|override)\s+(?:(?:all|any|every|the|your|my|these|those)\s+)*(?:of\s+)?(?:previous|prior|above|earlier|preceding|system|safety)\s+(?:instructions?|rules?|prompts?|messages?|context|directions?|guidelines?)\b`,
    String.raw`\b(?:ignore|disregard|forget)\s+(?:all|everything)\s+(?:above|before|previous|prior|you\s+(?:were|have\s+been)\s+told)\b`,
    String.raw`\bsystem\s+prompt\b`,
    String.raw`\byou\s+are\s+now\b`,
    String.raw`\bnew\s+(?:instructions?|rules?)\s*:`,
    String.raw`\b(?:output|respond\s+with|return|reply\s+with)\s+(?:only\s+)?(?:the\s+)?(?:following\s+)?(?:json|market_question)\b`,
    String.raw`\b(?:market_question|initial_yes_probability|resolution_oracle|expiry_timestamp|grounding_signal_ids|settlement_currency|minimum_liquidity_usdc|confidence_interval)\b`,
    String.raw`\brequired\s+json\s+structure\b`,
    String.raw`</?\s*(?:untrusted_signals|existing_markets|system|assistant|instructions?)\b`,
  ].join('|'),
  'i',
);

export function looksLikeInstruction(text: string): boolean {
  return INSTRUCTION_RE.test(text.normalize('NFKC'));
}

export function sanitizeSignalText(
  input: string,
  maxLen: number,
): { text: string; flags: SanitizeFlag[]; urls: string[] } {
  const flags = new Set<SanitizeFlag>();
  let text = String(input ?? '').normalize('NFKC');

  // Line breaks and tabs become spaces first; whatever control or format
  // characters remain (zero-width, bidi overrides, NUL…) are removed.
  text = text.replace(/[\t\n\r\f\v\u2028\u2029]+/g, ' ');
  const stripped = text.replace(/[\p{Cc}\p{Cf}]/gu, '');
  if (stripped.length !== text.length) flags.add('stripped_control');
  text = stripped;

  const urls = text.match(URL_RE) ?? [];
  if (urls.length > 0) {
    flags.add('had_url');
    text = text.replace(URL_RE, ' ');
  }

  text = text.replace(/\s+/gu, ' ').trim();

  const chars = Array.from(text);
  if (chars.length > maxLen) {
    text = chars.slice(0, maxLen).join('').trimEnd();
    flags.add('truncated');
  }

  if (looksLikeInstruction(text)) flags.add('instruction_like');
  return { text, flags: [...flags], urls };
}

const SAFE_TOKEN_RE = /[^A-Za-z0-9_.-]/g;

/**
 * Sanitises one ingested signal. Idempotent, so already-clean cached rows pass
 * through unchanged. FRED rows are built by our code from numbers; they are
 * sanitised like the rest but never flagged `instruction_like`.
 */
export function sanitizeSignal(
  raw: RawSignal & { url?: string; id?: string; sanitizedFlags?: string[] },
): SanitizedSignal {
  const source = String(raw.source ?? '').normalize('NFKC').replace(SAFE_TOKEN_RE, '').slice(0, 40).toUpperCase() || 'UNKNOWN';
  const title = sanitizeSignalText(raw.title, MAX_TITLE_CHARS);
  const content = sanitizeSignalText(raw.content, MAX_CONTENT_CHARS);
  const category = String(raw.category ?? '').replace(SAFE_TOKEN_RE, '').slice(0, 40);

  // Flags from an earlier pass are kept, so re-sanitising a cached row is lossless.
  const flags = new Set<SanitizeFlag>([...title.flags, ...content.flags, ...((raw.sanitizedFlags ?? []) as SanitizeFlag[])]);
  const urls = [...title.urls, ...content.urls];
  const url = raw.url || urls[0];
  if (url) flags.add('had_url');
  if (source === 'FRED') flags.delete('instruction_like');

  return {
    source,
    title: title.text,
    content: content.text,
    publishedAt: raw.publishedAt,
    relevanceScore: raw.relevanceScore,
    category,
    ...(url ? { url } : {}),
    ...(raw.id ? { id: raw.id } : {}),
    sanitizedFlags: [...flags],
  };
}

/** Flagged signals never reach the model. FRED is exempt (see sanitizeSignal). */
export function partitionSignals<T extends SanitizedSignal>(signals: T[]): { clean: T[]; quarantined: T[] } {
  const clean: T[] = [];
  const quarantined: T[] = [];
  for (const s of signals) (s.sanitizedFlags.includes('instruction_like') ? quarantined : clean).push(s);
  return { clean, quarantined };
}

function escapeLookalikes(text: string, label: string): string {
  const names = new Set([label, 'untrusted_signals', 'existing_markets', 'system', 'assistant']);
  return text.replace(new RegExp(`<\\s*/?\\s*(?=${[...names].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi'), '‹');
}

/**
 * Renders signals as data: one JSON object per line inside a block whose tag
 * carries a fresh random nonce (never derived from content, so an attacker
 * cannot precompute the closing tag). JSON.stringify escapes quotes and line
 * breaks; look-alikes of the delimiter inside the text become `‹label`.
 */
export function renderUntrustedBlock(signals: SanitizedSignal[], label: string, fixedNonce?: string): string {
  // `fixedNonce` exists only so the offline evaluation (#67) can hash a prompt
  // reproducibly; production callers always get a fresh random nonce.
  const nonce = fixedNonce ?? randomBytes(6).toString('hex');
  const lines = signals.map((s, i) =>
    JSON.stringify({
      id: s.id ?? `${label.charAt(0)}${i + 1}`,
      source: escapeLookalikes(s.source, label),
      title: escapeLookalikes(s.title, label),
      content: escapeLookalikes(s.content, label),
    }),
  );
  return [`<${label} nonce="${nonce}">`, ...lines, `</${label} nonce="${nonce}">`].join('\n');
}

/**
 * Renders a small JSON record (a question document, #75) as one line of data
 * inside a nonce-delimited block. Every string is sanitised like signal text
 * and delimiter look-alikes are escaped. Returns null when any string looks
 * like an instruction: such a record is quarantined, not sent.
 */
export function renderUntrustedRecord(
  record: Record<string, unknown>,
  label: string,
  fixedNonce?: string,
  maxStringChars = MAX_CONTENT_CHARS,
): string | null {
  let suspicious = false;
  const clean = (value: unknown): unknown => {
    if (typeof value === 'string') {
      const { text, flags } = sanitizeSignalText(value, maxStringChars);
      if (flags.includes('instruction_like')) suspicious = true;
      return escapeLookalikes(text, label);
    }
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clean(v)]));
    return value;
  };
  const body = JSON.stringify(clean(record));
  if (suspicious) return null;
  const nonce = fixedNonce ?? randomBytes(6).toString('hex');
  return [`<${label} nonce="${nonce}">`, body, `</${label} nonce="${nonce}">`].join('\n');
}

// ─── Post-generation policy ───────────────────────────────────────────────────

export type GuardReason =
  | 'UNGROUNDED'
  | 'PROBABILITY_OUT_OF_POLICY'
  | 'EXPIRY_OUT_OF_RANGE'
  | 'ORACLE_NOT_ALLOWED'
  | 'BANNED_TOPIC'
  | 'URL_IN_QUESTION'
  | 'INSTRUCTION_ECHO'
  | 'NON_ASCII_CONTROL';

export type GuardResult =
  | { ok: true }
  | { ok: false; reasons: GuardReason[]; detail: Record<string, unknown> };

/** Frozen on purpose: changing the policy is a code change that gets reviewed. */
export const BANNED_TOPIC_PATTERNS: readonly RegExp[] = Object.freeze([
  // self-harm
  /\b(?:suicid\w*|self[- ]?harm|kill\s+(?:him|her|them|my|your)self|overdose)\b/i,
  // death markets
  /\b(?:will|would|does|did)\b[^?]{0,80}\b(?:die|dies|dead|pass(?:es)?\s+away|be\s+(?:killed|murdered|assassinated|shot))\b/i,
  /\b(?:death|assassination|murder)\s+of\b/i,
  // private individuals
  /\b(?:my|your|his|her|their)\s+(?:neighbou?r|boss|ex|wife|husband|girlfriend|boyfriend|coworker|classmate|teacher|landlord)\b/i,
  /\bprivate\s+(?:citizen|individual|person)\b/i,
  /\b(?:doxx?|home\s+address|social\s+security)\b/i,
]);

const HANDLE_RE = /(?:^|[\s(])@[A-Za-z0-9_]{2,}/;
const URLISH_RE = /https?:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|org|net|io|xyz|info|example)\b/i;
const FENCE_RE = /```|`/;
const CONTROL_RE = /[\p{Cc}\p{Cf}]/u;

const DAY_SECONDS = 86_400;

export function checkProposal(
  p: MarketProposal,
  signals: SanitizedSignal[],
  now: Date,
): GuardResult {
  const reasons = new Set<GuardReason>();
  const detail: Record<string, unknown> = {};

  // Grounding: cited ids must be signals that were actually sent, and at least
  // one of them must share meaningful words with the question.
  const byId = new Map(signals.filter((s) => s.id).map((s) => [s.id as string, s]));
  const cited = Array.isArray(p.grounding_signal_ids) ? p.grounding_signal_ids : [];
  const unknown = cited.filter((id) => !byId.has(id));
  const questionTokens = new Set(meaningfulTokens(p.market_question));
  const overlaps = cited
    .map((id) => byId.get(id))
    .filter((s): s is SanitizedSignal => Boolean(s))
    .map((s) => meaningfulTokens(`${s.title} ${s.content}`).filter((t) => questionTokens.has(t)).length);
  const bestOverlap = overlaps.length > 0 ? Math.max(...overlaps) : 0;
  if (cited.length === 0 || unknown.length > 0 || bestOverlap < MIN_GROUNDING_TOKEN_OVERLAP) {
    reasons.add('UNGROUNDED');
    detail.grounding = { cited: cited.length, unknownIds: unknown.length, bestTokenOverlap: bestOverlap };
  }

  if (
    !Number.isFinite(p.initial_yes_probability) ||
    p.initial_yes_probability < MIN_INITIAL_PROBABILITY ||
    p.initial_yes_probability > MAX_INITIAL_PROBABILITY
  ) {
    reasons.add('PROBABILITY_OUT_OF_POLICY');
    detail.probability = p.initial_yes_probability;
  }

  const nowSeconds = Math.floor(now.getTime() / 1000);
  const expiry = p.expiry_timestamp;
  if (
    !Number.isFinite(expiry) ||
    expiry < nowSeconds + MIN_EXPIRY_DAYS * DAY_SECONDS ||
    expiry > nowSeconds + MAX_EXPIRY_DAYS * DAY_SECONDS
  ) {
    reasons.add('EXPIRY_OUT_OF_RANGE');
    detail.expiryDays = Number.isFinite(expiry) ? Math.round(((expiry - nowSeconds) / DAY_SECONDS) * 10) / 10 : null;
  }

  if (!ALLOWED_ORACLES.includes(p.resolution_oracle)) {
    reasons.add('ORACLE_NOT_ALLOWED');
    detail.oracleLength = String(p.resolution_oracle ?? '').length;
  }

  const prose = [p.market_question, p.reasoning, p.resolution_oracle].map((t) => String(t ?? ''));
  const text = prose.join('\n');
  if (BANNED_TOPIC_PATTERNS.some((re) => re.test(text))) reasons.add('BANNED_TOPIC');
  if (prose.some((t) => URLISH_RE.test(t) || HANDLE_RE.test(t) || FENCE_RE.test(t))) reasons.add('URL_IN_QUESTION');
  if (looksLikeInstruction(prose[0]) || looksLikeInstruction(prose[1])) reasons.add('INSTRUCTION_ECHO');
  if (prose.some((t) => CONTROL_RE.test(t))) reasons.add('NON_ASCII_CONTROL');

  return reasons.size === 0 ? { ok: true } : { ok: false, reasons: [...reasons], detail };
}

// ─── Cross-source corroboration (#228) ────────────────────────────────────────
//
// The injection guard above checks that a proposal cites signals that were
// really sent. It cannot tell a real story from a planted one: one article is
// enough to pass it. This gate asks for the proposal's claim to be reported by
// independent publishers, or to be backed by an authoritative structured
// source. Independence is counted in clusters merged by registrable domain and
// rewrite distance, never in URLs, because wire copy is syndicated under many
// mastheads. Pure: the service wrapper (corroboration.service.ts) does the I/O.

export interface CorroborationPolicy {
  /** Independent units needed for CORROBORATED. */
  minPublishers: number;
  /** Candidates must be published within this many hours before `now`. */
  windowHours: number;
  /** Clusters whose texts are within this SimHash distance are one unit (looser than clustering). */
  simhashRewrite: number;
}

export interface CorroboratorRef {
  signalId: string;
  clusterId: string;
  domain: string;
  source: string;
  publishedAt: string;
}

export type CorroborationVerdict =
  | { ok: true; kind: 'CORROBORATED' | 'AUTHORITATIVE'; corroborators: CorroboratorRef[]; detail: Record<string, unknown> }
  | { ok: false; kind: 'UNCORROBORATED'; corroborators: CorroboratorRef[]; detail: Record<string, unknown> };

/** The SignalRow fields the check reads. */
export type CorroborationCandidate = Pick<
  SignalRow,
  'id' | 'source' | 'clusterId' | 'url' | 'publisher' | 'title' | 'summary' | 'publishedAt' | 'simhash'
>;

export interface CorroborationInput {
  /** The sanitised question text (model output: never the raw proposal). */
  question: string;
  category: string;
  grounding: AggregatedSignal[];
  candidates: CorroborationCandidate[];
  resolutionSourceId: SourceId | null;
  meeting: MeetingDef | null;
  now: Date;
}

const HOUR_MS = 3_600_000;

/** FRED series id of a FRED signal ("FEDFUNDS: 4.33", …/series/FEDFUNDS). */
function fredSeriesOf(s: Pick<AggregatedSignal, 'title' | 'url'>): string | null {
  const fromUrl = /\/series\/([A-Z0-9]+)/.exec(s.url ?? '')?.[1];
  if (fromUrl) return fromUrl;
  return /^([A-Z0-9]+):/.exec(s.title)?.[1] ?? null;
}

/** Grounding signals as store-shaped candidates, so they count like any other row. */
function groundingCandidate(s: AggregatedSignal): CorroborationCandidate {
  return {
    id: s.signalId,
    source: s.source,
    clusterId: null,
    url: s.url ?? null,
    publisher: s.publisher,
    title: s.title,
    summary: s.content || null,
    publishedAt: new Date(s.publishedAt),
    simhash: simhash64(fingerprintText(s.title, s.content)),
  };
}

const byIdAsc = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function checkCorroboration(input: CorroborationInput, policy: CorroborationPolicy): CorroborationVerdict {
  const { now } = input;
  const windowStart = now.getTime() - policy.windowHours * HOUR_MS;

  // Claim: gazetteer entities must all be covered; without any, two proper nouns.
  const questionEntities = extractEntities(input.question);
  const gazetteer = [...questionEntities].filter((e) => !e.startsWith('NAME:')).sort();
  const names = [...questionEntities].filter((e) => e.startsWith('NAME:'));
  const questionTokens = new Set(meaningfulTokens(input.question));

  // Store rows first; a grounding signal the store no longer returns is added
  // from the aggregated copy. Sorted by id so input order never matters.
  const pool = new Map<string, CorroborationCandidate>();
  for (const c of input.candidates) pool.set(c.id, c);
  for (const g of input.grounding) if (g.signalId && !pool.has(g.signalId)) pool.set(g.signalId, groundingCandidate(g));

  const matches = (c: CorroborationCandidate): boolean => {
    // FRED rows have no URL and cluster per series: never news corroboration.
    if (c.source === 'FRED') return false;
    const at = c.publishedAt.getTime();
    if (!Number.isFinite(at) || at < windowStart || at > now.getTime()) return false;
    const text = `${c.title} ${c.summary ?? ''}`;
    const entities = extractEntities(text);
    const claim = gazetteer.length > 0
      ? gazetteer.every((e) => entities.has(e))
      : names.filter((e) => entities.has(e)).length >= 2;
    if (!claim) return false;
    return meaningfulTokens(text).filter((t) => questionTokens.has(t)).length >= MIN_GROUNDING_TOKEN_OVERLAP;
  };
  const matched = [...pool.values()].filter(matches).sort(byIdAsc);

  // Independence. A group is a near-duplicate cluster (or a lone row); groups
  // that share a registrable domain or are light rewrites of each other are
  // one unit. Union-find, so the result does not depend on candidate order.
  const groups = new Map<string, CorroborationCandidate[]>();
  for (const c of matched) {
    const key = c.clusterId ?? c.id;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const keys = [...groups.keys()].sort();
  const domainsOf = new Map(keys.map((k) => [
    k,
    new Set(groups.get(k)!.map((c) => publisherDomain(c.url, c.publisher)).filter((d): d is string => Boolean(d))),
  ]));
  const parent = new Map(keys.map((k) => [k, k]));
  const find = (k: string): string => {
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(k, r);
    return r;
  };
  const union = (a: string, b: string) => {
    const [ra, rb] = [find(a), find(b)];
    if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  };
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const [a, b] = [keys[i], keys[j]];
      const sharedDomain = [...domainsOf.get(a)!].some((d) => domainsOf.get(b)!.has(d));
      const rewrite = !sharedDomain && groups.get(a)!.some((x) => groups.get(b)!.some((y) =>
        x.simhash !== null && y.simhash !== null && hammingDistance(x.simhash, y.simhash) <= policy.simhashRewrite));
      if (sharedDomain || rewrite) union(a, b);
    }
  }
  const units = new Set(keys.map(find));
  const allDomains = [...new Set(keys.flatMap((k) => [...domainsOf.get(k)!]))].sort();
  // Distinct domains across units: each unit contributes its domains.
  const unitDomains = new Set([...units].flatMap((u) => keys.filter((k) => find(k) === u).flatMap((k) => [...domainsOf.get(k)!])));

  // One reference per group: its earliest article (ties by id).
  const corroborators: CorroboratorRef[] = keys.map((k) => {
    const rep = [...groups.get(k)!].sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime() || byIdAsc(a, b))[0];
    return {
      signalId: rep.id,
      clusterId: k,
      domain: [...domainsOf.get(k)!].sort()[0] ?? 'unknown',
      source: rep.source,
      publishedAt: rep.publishedAt.toISOString(),
    };
  }).sort((a, b) => (a.publishedAt < b.publishedAt ? -1 : a.publishedAt > b.publishedAt ? 1 : a.signalId < b.signalId ? -1 : 1));

  const detail: Record<string, unknown> = {
    units: units.size,
    domains: allDomains,
    matched: matched.length,
    entities: gazetteer.length > 0 ? gazetteer : names.sort(),
    windowHours: policy.windowHours,
    minPublishers: policy.minPublishers,
  };

  // Authoritative: a FRED series that measures the question…
  if (input.resolutionSourceId === 'FRED') {
    const series = fredSeriesFor(input.question);
    const backing = input.grounding
      .filter((g) => g.source === 'FRED' && series.includes(fredSeriesOf(g) ?? ''))
      .sort((a, b) => (a.signalId < b.signalId ? -1 : 1));
    if (backing.length > 0) {
      const fred = backing.map((g): CorroboratorRef => ({
        signalId: g.signalId,
        clusterId: `FRED:${fredSeriesOf(g)}`,
        domain: 'stlouisfed.org',
        source: 'FRED',
        publishedAt: new Date(g.publishedAt).toISOString(),
      }));
      return { ok: true, kind: 'AUTHORITATIVE', corroborators: [...fred, ...corroborators], detail: { ...detail, authority: 'FRED_SERIES', series: fred.map((f) => f.clusterId) } };
    }
  }
  // …or a scheduled central-bank meeting the question names, with coverage.
  if ((input.resolutionSourceId === 'FRED' || input.resolutionSourceId === 'ECB') && input.meeting && matched.length > 0) {
    return { ok: true, kind: 'AUTHORITATIVE', corroborators, detail: { ...detail, authority: 'MEETING_CALENDAR', meeting: input.meeting.date } };
  }

  if (units.size >= policy.minPublishers && unitDomains.size >= 2) {
    return { ok: true, kind: 'CORROBORATED', corroborators, detail };
  }
  return { ok: false, kind: 'UNCORROBORATED', corroborators, detail };
}
