/**
 * Graders for generated market proposals (#67). Each returns
 * { pass, score: 0..1, detail }. Rules are hard: the LLM judge can add a
 * failure but never turns a rule failure into a pass, and rule/judge
 * disagreements are reported separately.
 *
 * As of #240 the deterministic graders live in
 * `src/services/proposal-quality.ts` so the runtime market-maker gate can
 * share them. This module re-exports them and keeps label-aware
 * (`gradeCategory`, `gradeDuplicate`) and whole-case graders here.
 */
import type { MarketProposal } from '../../src/types';
import {
  binaryRule,
  gradeBinary,
  gradeCiConsistency,
  gradeDateSanity,
  gradeDuplicateQuestion,
  gradeResolutionSource,
  type GradeResult,
} from '../../src/services/proposal-quality';
import type { JudgeVerdict } from './judge-prompt.v1';

export {
  binaryRule,
  gradeBinary,
  gradeCiConsistency,
  gradeDateSanity,
  gradeResolutionSource,
};
export type { GradeResult };

export const GRADER_NAMES = [
  'schemaValid',
  'binary',
  'resolutionSource',
  'dateSanity',
  'category',
  'duplicateAccuracy',
  'ciConsistency',
] as const;
export type GraderName = (typeof GRADER_NAMES)[number];

export interface EvalCase {
  id: string;
  asOf: string;
  signals: { news: any[]; fed: any[]; macro: any[]; signalCount: number };
  existing: Array<{ question: string; category: string }>;
  labels: { category?: string | null; expectDuplicateOf?: string | null; notes?: string };
}

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

// ─── category / duplicates: label-aware, so they stay in the harness ────────
export function gradeCategory(category: string, label: string | null | undefined): GradeResult {
  if (!label) return result(true, { skipped: 'unlabelled' }, false);
  return result(category === label, { expected: label, got: category });
}

export function gradeDuplicate(
  question: string,
  existing: Array<{ question: string }>,
  expectDuplicateOf: string | null | undefined,
): GradeResult {
  const expected = expectDuplicateOf != null;
  const got = gradeDuplicateQuestion(question, existing.map((e) => e.question));
  return result(got === expected, { expectedDuplicate: expected, flaggedDuplicate: got });
}

// ─── whole case ──────────────────────────────────────────────────────────────
/** A parse failure fails every applicable grader, so a bad prompt cannot hide behind a small denominator. */
export function gradeCase(
  c: EvalCase,
  parsed: { proposal: MarketProposal } | { error: string },
  judge: JudgeVerdict | null,
): Record<GraderName, GradeResult> {
  if ('error' in parsed) {
    const fail = (applicable = true): GradeResult => ({
      pass: false,
      score: 0,
      applicable,
      detail: { reason: 'no valid proposal', error: parsed.error },
    });
    return {
      schemaValid: fail(),
      binary: fail(),
      resolutionSource: fail(),
      dateSanity: fail(),
      category: fail(!!c.labels.category),
      duplicateAccuracy: fail(),
      ciConsistency: fail(),
    };
  }
  const p = parsed.proposal;
  return {
    schemaValid: result(true),
    binary: gradeBinary(p.market_question, judge),
    resolutionSource: gradeResolutionSource(p.resolution_oracle, judge),
    dateSanity: gradeDateSanity(p.market_question, p.expiry_timestamp, new Date(c.asOf)),
    category: gradeCategory(String(p.category), c.labels.category),
    duplicateAccuracy: gradeDuplicate(p.market_question, c.existing, c.labels.expectDuplicateOf),
    ciConsistency: gradeCiConsistency(p.initial_yes_probability, p.confidence_interval),
  };
}
