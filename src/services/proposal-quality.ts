/**
 * Runtime-safe graders for generated market proposals (#240).
 *
 * The offline eval harness (`scripts/eval/graders.ts`) lives outside
 * `tsconfig.json`'s `rootDir`, so runtime code could not import it and the
 * live market-maker had no quality step beyond injection, resolvability and
 * dedup. This module is the shared source of truth for the deterministic
 * graders; the eval harness re-exports from here, and the runtime
 * proposal-quality gate wires them in as a pre-persist check.
 *
 * Each grader returns `{ pass, score, applicable, detail }`. Scores feed the
 * corpus pass-rate metrics in `tests/eval/thresholds.json`; a per-proposal
 * gate reads `pass` plus any per-dimension floors the caller supplies.
 *
 * NB: the runtime gate (judge call, repair loop, admin plumbing) is a
 * follow-up; this module is the minimum landing so adoption issues can
 * depend on a stable import path.
 */

import { ALLOWED_ORACLES } from './market-policy';
import { isDuplicateOf } from './market.service';
import { extractQuestionDates, dayDiff } from '../lib/question-dates';

export { extractQuestionDates, dayDiff } from '../lib/question-dates';

export interface GradeResult {
  pass: boolean;
  score: number;
  /** false when the case carries no label for this grader; it is then left out of rates. */
  applicable: boolean;
  detail: Record<string, unknown>;
}

const ORACLES = new Set<string>(ALLOWED_ORACLES);

const result = (
  pass: boolean,
  detail: Record<string, unknown> = {},
  applicable = true,
): GradeResult => ({
  pass,
  score: pass ? 1 : 0,
  applicable,
  detail,
});

// ─── binary-ness ─────────────────────────────────────────────────────────────
// "at or above", "on or before", "3% or more" are thresholds, not alternatives.
const BENIGN_OR =
  /\b(?:at or (?:above|below)|on or (?:before|after)|(?:[\w.,%$]+\s+)?or (?:more|less|fewer|higher|lower|greater|equal|earlier|later))\b/gi;
const COMPARATORS =
  /\b(?:above|below|exceed|exceeds|over|under|at least|at most|more than|less than|higher than|lower than|reach|reaches|hit|hits|rise|fall)\b/i;

export function binaryRule(question: string): { pass: boolean; reasons: string[] } {
  const q = question.trim();
  const reasons: string[] = [];
  const stripped = q.replace(BENIGN_OR, ' ');
  if ((q.match(/\?/g) ?? []).length !== 1 || !q.endsWith('?'))
    reasons.push('not exactly one question ending in "?"');
  if (!/^(?:will|is|are|does|do|did|has|have|can|could|would|should)\b/i.test(q))
    reasons.push('not phrased as a yes/no question');
  if (/\bor\b/i.test(stripped)) reasons.push('offers alternatives ("or")');
  if (/\bhow (?:many|much)\b/i.test(q)) reasons.push('asks for a quantity ("how many/much")');
  if (/\bwhich\b/i.test(q)) reasons.push('asks to choose ("which")');
  // "4.0 to 4.5" or "between X and Y" is a bucket, not a threshold; day
  // ranges ("October 23-25") and a policy "target range" are not buckets.
  const noDays = q.replace(/\b[A-Z][a-z]+\.?\s+\d{1,2}\s*[-–]\s*\d{1,2}\b/g, ' ');
  const bucket =
    /\bbetween\b[^?]*\band\b/i.test(noDays) ||
    /\d[\d.,]*\s*(?:%|percent)?\s*(?:to|[-–—])\s*\d[\d.,]*/i.test(noDays);
  if (bucket && !COMPARATORS.test(q)) reasons.push('range without a threshold');
  return { pass: reasons.length === 0, reasons };
}

/**
 * Narrow verdict the online judge is expected to produce. The v2 schema
 * will add `unambiguous`/`edge_cases_covered`/`neutral_wording`/`not_foregone`
 * (#240); this type is compatible with both v1 and that extension.
 */
export interface JudgeVerdict {
  /** 0 or 1. Typed as number so zod's `z.number().int().min(0).max(1)` output fits. */
  binary: number;
  /** 0 or 1. */
  verifiable: number;
  ambiguity_notes?: string;
  [extra: string]: unknown;
}

export function gradeBinary(question: string, judge: JudgeVerdict | null): GradeResult {
  const rule = binaryRule(question);
  const judged = judge ? judge.binary === 1 : null;
  const pass = rule.pass && judged !== false;
  return {
    pass,
    score: !rule.pass ? 0 : judged === null ? 1 : judge!.binary,
    applicable: true,
    detail: {
      rule,
      judge: judge ? { binary: judge.binary, notes: judge.ambiguity_notes } : null,
      disagreement: judged !== null && judged !== rule.pass,
    },
  };
}

export function gradeResolutionSource(oracle: string, judge: JudgeVerdict | null): GradeResult {
  const rule = ORACLES.has(oracle);
  const judged = judge ? judge.verifiable === 1 : null;
  return {
    pass: rule && judged !== false,
    score: !rule ? 0 : judged === null ? 1 : judge!.verifiable,
    applicable: true,
    detail: {
      oracle,
      inAllowList: rule,
      judge: judge ? { verifiable: judge.verifiable } : null,
      disagreement: judged !== null && judged !== rule,
    },
  };
}

export function gradeDateSanity(
  question: string,
  expiryTimestamp: number,
  asOf: Date,
): GradeResult {
  const expiry = new Date(expiryTimestamp * 1000);
  const days = (expiry.getTime() - asOf.getTime()) / 86_400_000;
  const inWindow = days >= 1 && days <= 90;
  const dates = extractQuestionDates(question, asOf);
  const stated = dates.length > 0 ? dates[dates.length - 1] : null;
  const delta = stated ? dayDiff(stated, expiry) : null;
  const consistent = delta === null || Math.abs(delta) <= 2;
  return result(inWindow && consistent, {
    expiry: expiry.toISOString(),
    daysFromAsOf: Number(days.toFixed(2)),
    inWindow,
    questionDates: dates.map((d) => d.toISOString().slice(0, 10)),
    deltaDays: delta,
  });
}

export function gradeCiConsistency(
  p: number,
  ci: { lower: number; upper: number },
): GradeResult {
  const ordered = ci.lower < p && p < ci.upper;
  const width = ci.upper - ci.lower;
  return result(ordered && width <= 0.4, {
    p,
    lower: ci.lower,
    upper: ci.upper,
    width: Number(width.toFixed(4)),
    ordered,
  });
}

/**
 * Duplicate check against a list of active markets — thin wrapper so the
 * runtime gate and the eval harness call the same function. Returns true
 * when `question` already exists under `isDuplicateOf`'s semantics.
 */
export function gradeDuplicateQuestion(question: string, existingQuestions: string[]): boolean {
  return isDuplicateOf(question, existingQuestions);
}
