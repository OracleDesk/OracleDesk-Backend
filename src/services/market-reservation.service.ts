/**
 * Market reservation service (#283).
 *
 * Makes dedup + insert atomic across concurrent generation cycles (cron
 * instances, admin triggers) without serialising the whole cycle. The advisory
 * lock is held only for the check-and-reserve section — never around LLM calls,
 * embedding calls or chain I/O.
 */
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { withAdvisoryLockWait } from '../lib/advisory-lock';
import { config } from '../config';
import { logger } from '../lib/logger';
import { confirmDuplicate, findLexicalMatch, type DedupMatch } from './market.service';
import { normalizeQuestion } from './embeddings.service';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReserveInput {
  proposal: {
    market_question: string;
    category: string;
    expiry_timestamp: number;
  };
  cycleId: string;
  /** Pre-computed embedding — reuse what checkDuplicate already computed. */
  vector?: { model: string; values: number[] };
}

export type ReserveResult =
  | { ok: true; reservationId: string }
  | { ok: false; reason: 'committed-duplicate' | 'reserved'; match: DedupMatch; competingReservationId?: string };

// Advisory lock key — distinctive prefix avoids hash collisions with other keys.
const DEDUP_LOCK_KEY = 'oracledesk:market-dedup:global';

// ─── Key helpers ─────────────────────────────────────────────────────────────

/**
 * A stable key for exact-duplicate detection that is not collapsed by
 * normalizeQuestion's date substitution. Uses the UTC day of expiry so
 * "March" and "June" variants of the same question have different keys.
 */
function exactKey(question: string, expiryTimestamp: number): string {
  const day = new Date(expiryTimestamp * 1000).toISOString().slice(0, 10); // YYYY-MM-DD
  return `${day}::${question.trim().toLowerCase()}`;
}

function questionKey(question: string, expiryTimestamp: number): string {
  return createHash('sha256').update(exactKey(question, expiryTimestamp)).digest('hex');
}

// ─── Cosine similarity ───────────────────────────────────────────────────────

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ─── Main API ────────────────────────────────────────────────────────────────

/**
 * Check committed markets and held reservations under one short global advisory
 * lock, then insert a reservation row if neither blocks.
 *
 * The expensive embedding call (step 0) runs before the lock is acquired so the
 * lock is never held while waiting on the embedding provider.
 */
export async function reserveProposal(input: ReserveInput): Promise<ReserveResult> {
  const { proposal, cycleId, vector } = input;
  const expiry = new Date(proposal.expiry_timestamp * 1000);
  const checkStartedAt = new Date();

  // Step 0: Check committed markets (outside the lock — a redundant read is
  // cheap, the lock guards only the race window).
  const committedCheck = await checkCommitted(proposal, expiry, vector);
  if (committedCheck) {
    logger.info({ marketId: committedCheck.marketId, method: committedCheck.method }, 'reserveProposal: committed duplicate');
    return { ok: false, reason: 'committed-duplicate', match: committedCheck };
  }

  // Steps 1–5 run inside the advisory lock.
  const lockResult = await withAdvisoryLockWait(
    DEDUP_LOCK_KEY,
    async (tx) => {
      // Step 1: Expire stale leases.
      await expireReservationsTx(tx);

      // Step 2: Load held reservations (normally 0–5 rows).
      const held = await tx.marketReservation.findMany({
        where: { status: 'HELD' },
        select: {
          id: true, question: true, expiryTimestamp: true,
          embeddingModel: true, embeddingVector: true,
        },
      });

      // Step 3: Check held reservations with the same dedup rules.
      for (const r of held) {
        const rExpiry = new Date(r.expiryTimestamp);
        const rVec = r.embeddingVector as number[] | null;
        let similarity = 0;
        let method: 'semantic' | 'lexical' = 'lexical';

        if (vector && rVec && r.embeddingModel === vector.model) {
          similarity = cosine(vector.values, rVec);
          method = 'semantic';
        }

        if (method === 'semantic' && similarity >= config.DEDUP_SIM_THRESHOLD) {
          const verdict = confirmDuplicate(
            { question: proposal.market_question, expiry },
            { question: r.question, expiry: rExpiry, similarity },
          );
          if (verdict.duplicate) {
            return { ok: false as const, reason: 'reserved' as const, match: { marketId: r.id, question: r.question, similarity, reason: verdict.reason }, competingReservationId: r.id };
          }
        } else {
          const hit = findLexicalMatch(proposal.market_question, [r.question]);
          if (hit) {
            return { ok: false as const, reason: 'reserved' as const, match: { marketId: r.id, question: r.question, similarity: hit.jaccard, reason: 'lexical overlap with held reservation' }, competingReservationId: r.id };
          }
        }
      }

      // Step 4: Re-check committed markets that arrived since checkStartedAt.
      const recent = await tx.market.findMany({
        where: { status: { in: ['PENDING', 'ACTIVE'] }, createdAt: { gt: checkStartedAt } },
        select: { id: true, question: true, expiryTimestamp: true },
      });
      for (const m of recent) {
        const hit = findLexicalMatch(proposal.market_question, [m.question]);
        if (hit) {
          return { ok: false as const, reason: 'committed-duplicate' as const, match: { marketId: m.id, question: m.question, similarity: hit.jaccard, reason: 'lexical overlap with market created during lock wait' } };
        }
      }

      // Step 5: Insert the reservation.
      const leaseUntil = new Date(Date.now() + config.MARKET_RESERVATION_LEASE_MS);
      const row = await tx.marketReservation.create({
        data: {
          cycleId,
          question: proposal.market_question,
          questionKey: questionKey(proposal.market_question, proposal.expiry_timestamp),
          category: normalizeCategory(proposal.category) as any,
          expiryTimestamp: expiry,
          embeddingModel: vector?.model ?? null,
          embeddingVector: vector ? vector.values : Prisma.DbNull,
          status: 'HELD',
          leaseUntil,
        },
      });
      return { ok: true as const, reservationId: row.id };
    },
    { waitMs: 10_000, timeoutMs: 60_000 },
  );

  if (!lockResult.acquired) {
    logger.warn({ cycleId }, 'reserveProposal: could not acquire advisory lock — treating as reserved');
    return { ok: false, reason: 'reserved', match: { marketId: '', question: '', similarity: 0, reason: 'advisory lock timed out' } };
  }

  return lockResult.value;
}

/** Promote a reservation to COMMITTED and record the created market id. */
export async function commitReservation(id: string, marketId: string, tx?: Prisma.TransactionClient): Promise<void> {
  const client = tx ?? prisma;
  await client.marketReservation.update({
    where: { id },
    data: { status: 'COMMITTED', marketId },
  });
}

/** Release a reservation that did not result in a market (skip, abort, failure). */
export async function releaseReservation(id: string, reason: string): Promise<void> {
  await prisma.marketReservation.update({
    where: { id },
    data: { status: 'RELEASED' },
  }).catch((err) => logger.warn({ err, id, reason }, 'releaseReservation: row not found or already released'));
}

/** Extend the lease before a long step (chain call, LLM call). */
export async function extendLease(id: string): Promise<void> {
  const leaseUntil = new Date(Date.now() + config.MARKET_RESERVATION_LEASE_MS);
  await prisma.marketReservation.updateMany({
    where: { id, status: 'HELD' },
    data: { leaseUntil },
  });
}

/** Expire HELD rows whose lease has passed. Returns the number deleted. */
export async function expireReservations(now = new Date()): Promise<number> {
  const { count } = await prisma.marketReservation.deleteMany({
    where: { status: 'HELD', leaseUntil: { lt: now } },
  });
  if (count > 0) logger.info({ count }, 'expireReservations: reaped expired reservations');
  return count;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function expireReservationsTx(tx: Prisma.TransactionClient): Promise<void> {
  await tx.marketReservation.deleteMany({
    where: { status: 'HELD', leaseUntil: { lt: new Date() } },
  });
}

type CommittedMatch = DedupMatch & { method: 'semantic' | 'lexical' };

async function checkCommitted(
  proposal: ReserveInput['proposal'],
  expiry: Date,
  vector: ReserveInput['vector'] | undefined,
): Promise<CommittedMatch | null> {

  const active = await prisma.market.findMany({
    where: { status: { in: ['PENDING', 'ACTIVE'] } },
    select: { id: true, question: true, expiryTimestamp: true },
  });

  for (const m of active) {
    const hit = findLexicalMatch(proposal.market_question, [m.question]);
    if (hit) {
      const verdict = confirmDuplicate(
        { question: proposal.market_question, expiry },
        { question: m.question, expiry: new Date(m.expiryTimestamp), similarity: hit.jaccard },
      );
      if (verdict.duplicate) {
        return { marketId: m.id, question: m.question, similarity: hit.jaccard, reason: verdict.reason, method: 'lexical' };
      }
    }
  }
  return null;
}

/** Mirrors normalizeCategory in market.service without a circular import. */
function normalizeCategory(raw: string): string {
  return raw.toUpperCase();
}
