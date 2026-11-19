/**
 * IPFS pin ledger (#328).
 *
 * Records every remote pin (`ipfs_pins`) and every use of it by a market
 * question or reasoning trace (`ipfs_pin_refs`). A reference is ANCHORED once
 * the owner is linked on chain; an anchored CID is never unpinned. The GC job
 * (`src/jobs/pin-gc.job.ts`) only unpins CIDs whose references are all RELEASED.
 *
 * Storage sits behind `PinLedger` so tests can use the in-memory
 * implementation; production uses Postgres with row locks.
 */
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

export type PinStatus = 'PINNING' | 'PINNED' | 'UNPIN_PENDING' | 'UNPINNED' | 'FAILED';
/** DOCUMENT: published documents without a trace row (transparency reports); never auto-released. */
export type PinOwnerKind = 'MARKET_QUESTION' | 'TRACE' | 'DOCUMENT';
export type PinRefState = 'CANDIDATE' | 'ANCHORED' | 'RELEASED';

export interface PinOwner {
  kind: PinOwnerKind;
  id: string;
}

export interface PinRecord {
  cid: string;
  sha256: string;
  size: number;
  provider: string;
  status: PinStatus;
  repinRequested: boolean;
  pinnedAt: Date | null;
  unpinnedAt: Date | null;
  lastError: string | null;
}

export interface PinRef {
  cid: string;
  ownerKind: PinOwnerKind;
  ownerId: string;
  state: PinRefState;
  anchor: string | null;
}

export interface PinLedger {
  /**
   * Records intent to pin `cid` for `owner`. Returns `PIN` when the caller
   * must call the provider, `SKIP` when the document is already pinned (or an
   * in-flight unpin has been told to restore it).
   */
  acquire(input: {
    cid: string;
    sha256: string;
    size: number;
    provider: string;
    owner?: PinOwner;
  }): Promise<'PIN' | 'SKIP'>;
  markPinned(cid: string, now?: Date): Promise<void>;
  markFailed(cid: string, error: string): Promise<void>;
  /** Marks every reference of the owner ANCHORED; returns how many changed. */
  anchor(owner: PinOwner, anchor: string, now?: Date): Promise<number>;
  /** References that are not yet ANCHORED or RELEASED. */
  listCandidateRefs(limit?: number): Promise<PinRef[]>;
  release(ref: Pick<PinRef, 'cid' | 'ownerKind' | 'ownerId'>): Promise<void>;
  /**
   * Atomically selects PINNED pins with no CANDIDATE/ANCHORED reference (and at
   * least one RELEASED reference, or none and older than `orphanBefore`) and
   * marks them UNPIN_PENDING. Safe with several instances.
   */
  claimUnpinnable(orphanBefore: Date, limit: number): Promise<PinRecord[]>;
  /** Unpin finished: returns whether a re-pin was requested meanwhile. */
  finishUnpin(cid: string, now?: Date): Promise<{ repin: boolean }>;
  /** Unpin failed or was abandoned: put the pin back to PINNED. */
  restorePinned(cid: string, error?: string): Promise<void>;
  get(cid: string): Promise<PinRecord | null>;
  refsFor(cid: string): Promise<PinRef[]>;
  /** Registers a pin that already exists at the provider (reconciliation). */
  importPin(input: { cid: string; sha256?: string; size: number; provider: string; pinnedAt?: Date | null }): Promise<boolean>;
  /** Adds a reference without changing the pin status (reconciliation). */
  addRef(owner: PinOwner, cid: string, state?: PinRefState, anchor?: string | null): Promise<void>;
}

// ───────────────────────── Postgres implementation ─────────────────────────

function rowToPin(r: any): PinRecord {
  return {
    cid: r.cid,
    sha256: r.sha256,
    size: r.size,
    provider: r.provider,
    status: r.status,
    repinRequested: r.repinRequested,
    pinnedAt: r.pinnedAt ?? null,
    unpinnedAt: r.unpinnedAt ?? null,
    lastError: r.lastError ?? null,
  };
}

const rowToRef = (r: any): PinRef => ({
  cid: r.cid,
  ownerKind: r.ownerKind,
  ownerId: r.ownerId,
  state: r.state,
  anchor: r.anchor ?? null,
});

async function upsertRef(tx: Prisma.TransactionClient, cid: string, owner: PinOwner): Promise<void> {
  // ON CONFLICT keeps the transaction alive when two callers add the same reference.
  await tx.$executeRaw`
    INSERT INTO "ipfs_pin_refs" ("id", "cid", "ownerKind", "ownerId", "state")
    VALUES (${randomUUID()}, ${cid}, ${owner.kind}, ${owner.id}, 'CANDIDATE')
    ON CONFLICT ("cid", "ownerKind", "ownerId")
    DO UPDATE SET "state" = CASE WHEN "ipfs_pin_refs"."state" = 'RELEASED' THEN 'CANDIDATE' ELSE "ipfs_pin_refs"."state" END`;
}

export const postgresPinLedger: PinLedger = {
  async acquire({ cid, sha256, size, provider, owner }) {
    return prisma.$transaction(async (tx) => {
      const lock = () =>
        tx.$queryRaw<Array<{ status: PinStatus }>>`SELECT "status" FROM "ipfs_pins" WHERE "cid" = ${cid} FOR UPDATE`;

      let rows = await lock();
      if (rows.length === 0) {
        // ON CONFLICT instead of catching P2002: a unique violation would abort
        // the whole transaction in Postgres.
        const inserted = await tx.$executeRaw`
          INSERT INTO "ipfs_pins" ("cid", "sha256", "size", "provider", "status", "updatedAt")
          VALUES (${cid}, ${sha256}, ${size}, ${provider}, 'PINNING', now())
          ON CONFLICT ("cid") DO NOTHING`;
        if (inserted === 0) rows = await lock(); // lost the race: wait for the winner's row
        else rows = [{ status: 'PINNING' }];
      }

      const status = rows[0]?.status ?? 'PINNING';
      let decision: 'PIN' | 'SKIP';
      if (status === 'PINNED') {
        decision = 'SKIP';
      } else if (status === 'UNPIN_PENDING') {
        await tx.ipfsPin.update({ where: { cid }, data: { repinRequested: true } });
        decision = 'SKIP';
      } else {
        // PINNING (ours or a concurrent caller's; the provider call is idempotent), FAILED or UNPINNED.
        if (status !== 'PINNING') await tx.ipfsPin.update({ where: { cid }, data: { status: 'PINNING', lastError: null } });
        decision = 'PIN';
      }
      if (owner) await upsertRef(tx, cid, owner);
      return decision;
    });
  },

  async markPinned(cid, now = new Date()) {
    await prisma.ipfsPin.update({
      where: { cid },
      data: { status: 'PINNED', pinnedAt: now, lastError: null, repinRequested: false },
    });
  },

  async markFailed(cid, error) {
    await prisma.ipfsPin.updateMany({
      where: { cid, status: 'PINNING' },
      data: { status: 'FAILED', lastError: error.slice(0, 500) },
    });
  },

  async anchor(owner, anchor, now = new Date()) {
    const res = await prisma.ipfsPinRef.updateMany({
      where: { ownerKind: owner.kind, ownerId: owner.id, state: { not: 'ANCHORED' } },
      data: { state: 'ANCHORED', anchoredAt: now, anchor },
    });
    return res.count;
  },

  async listCandidateRefs(limit = 500) {
    const rows = await prisma.ipfsPinRef.findMany({ where: { state: 'CANDIDATE' }, take: limit, orderBy: { createdAt: 'asc' } });
    return rows.map(rowToRef);
  },

  async release(ref) {
    await prisma.ipfsPinRef.updateMany({
      where: { cid: ref.cid, ownerKind: ref.ownerKind, ownerId: ref.ownerId, state: 'CANDIDATE' },
      data: { state: 'RELEASED' },
    });
  },

  async claimUnpinnable(orphanBefore, limit) {
    return prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ cid: string }>>`
        SELECT p."cid" FROM "ipfs_pins" p
        WHERE p."status" = 'PINNED'
          AND NOT EXISTS (
            SELECT 1 FROM "ipfs_pin_refs" r
            WHERE r."cid" = p."cid" AND r."state" IN ('CANDIDATE', 'ANCHORED'))
          AND (
            EXISTS (SELECT 1 FROM "ipfs_pin_refs" r WHERE r."cid" = p."cid")
            OR p."pinnedAt" < ${orphanBefore})
        ORDER BY p."pinnedAt" NULLS FIRST
        LIMIT ${limit}
        FOR UPDATE OF p SKIP LOCKED`;
      if (rows.length === 0) return [];
      const cids = rows.map((r) => r.cid);
      await tx.ipfsPin.updateMany({ where: { cid: { in: cids } }, data: { status: 'UNPIN_PENDING', repinRequested: false } });
      const claimed = await tx.ipfsPin.findMany({ where: { cid: { in: cids } } });
      return claimed.map(rowToPin);
    });
  },

  async finishUnpin(cid, now = new Date()) {
    const row = await prisma.ipfsPin.update({
      where: { cid },
      data: { status: 'UNPINNED', unpinnedAt: now },
    });
    return { repin: row.repinRequested };
  },

  async restorePinned(cid, error) {
    await prisma.ipfsPin.updateMany({
      where: { cid, status: 'UNPIN_PENDING' },
      data: { status: 'PINNED', repinRequested: false, lastError: error ? error.slice(0, 500) : null },
    });
  },

  async get(cid) {
    const row = await prisma.ipfsPin.findUnique({ where: { cid } });
    return row ? rowToPin(row) : null;
  },

  async refsFor(cid) {
    return (await prisma.ipfsPinRef.findMany({ where: { cid } })).map(rowToRef);
  },

  async importPin({ cid, sha256, size, provider, pinnedAt }) {
    const existing = await prisma.ipfsPin.findUnique({ where: { cid } });
    if (existing) return false;
    await prisma.ipfsPin.create({
      data: { cid, sha256: sha256 ?? '', size, provider, status: 'PINNED', pinnedAt: pinnedAt ?? new Date() },
    });
    return true;
  },

  async addRef(owner, cid, state = 'CANDIDATE', anchor = null) {
    await prisma.ipfsPinRef.upsert({
      where: { cid_ownerKind_ownerId: { cid, ownerKind: owner.kind, ownerId: owner.id } },
      create: { cid, ownerKind: owner.kind, ownerId: owner.id, state, anchor, anchoredAt: state === 'ANCHORED' ? new Date() : null },
      update: {},
    });
  },
};

// ─────────────────────────── In-memory implementation ──────────────────────

/** Test double with the same transition rules as the Postgres ledger. */
export function createMemoryPinLedger(): PinLedger & { pins: Map<string, PinRecord>; refs: PinRef[] } {
  const pins = new Map<string, PinRecord>();
  const refs: PinRef[] = [];
  const key = (r: Pick<PinRef, 'cid' | 'ownerKind' | 'ownerId'>) => `${r.cid}|${r.ownerKind}|${r.ownerId}`;
  const find = (r: Pick<PinRef, 'cid' | 'ownerKind' | 'ownerId'>) => refs.find((x) => key(x) === key(r));

  const ledger: PinLedger & { pins: Map<string, PinRecord>; refs: PinRef[] } = {
    pins,
    refs,
    async acquire({ cid, sha256, size, provider, owner }) {
      const pin = pins.get(cid);
      let decision: 'PIN' | 'SKIP';
      if (!pin) {
        pins.set(cid, {
          cid, sha256, size, provider, status: 'PINNING', repinRequested: false,
          pinnedAt: null, unpinnedAt: null, lastError: null,
        });
        decision = 'PIN';
      } else if (pin.status === 'PINNED') {
        decision = 'SKIP';
      } else if (pin.status === 'UNPIN_PENDING') {
        pin.repinRequested = true;
        decision = 'SKIP';
      } else {
        pin.status = 'PINNING';
        pin.lastError = null;
        decision = 'PIN';
      }
      if (owner) {
        const ref = find({ cid, ownerKind: owner.kind, ownerId: owner.id });
        if (!ref) refs.push({ cid, ownerKind: owner.kind, ownerId: owner.id, state: 'CANDIDATE', anchor: null });
        else if (ref.state === 'RELEASED') ref.state = 'CANDIDATE';
      }
      return decision;
    },
    async markPinned(cid, now = new Date()) {
      const pin = pins.get(cid);
      if (pin) Object.assign(pin, { status: 'PINNED', pinnedAt: now, lastError: null, repinRequested: false });
    },
    async markFailed(cid, error) {
      const pin = pins.get(cid);
      if (pin && pin.status === 'PINNING') Object.assign(pin, { status: 'FAILED', lastError: error });
    },
    async anchor(owner, anchor) {
      let n = 0;
      for (const r of refs) {
        if (r.ownerKind === owner.kind && r.ownerId === owner.id && r.state !== 'ANCHORED') {
          r.state = 'ANCHORED';
          r.anchor = anchor;
          n++;
        }
      }
      return n;
    },
    async listCandidateRefs(limit = 500) {
      return refs.filter((r) => r.state === 'CANDIDATE').slice(0, limit).map((r) => ({ ...r }));
    },
    async release(ref) {
      const r = find(ref);
      if (r && r.state === 'CANDIDATE') r.state = 'RELEASED';
    },
    async claimUnpinnable(orphanBefore, limit) {
      const out: PinRecord[] = [];
      for (const pin of pins.values()) {
        if (out.length >= limit) break;
        if (pin.status !== 'PINNED') continue;
        const mine = refs.filter((r) => r.cid === pin.cid);
        if (mine.some((r) => r.state === 'CANDIDATE' || r.state === 'ANCHORED')) continue;
        if (mine.length === 0 && !(pin.pinnedAt && pin.pinnedAt < orphanBefore)) continue;
        pin.status = 'UNPIN_PENDING';
        pin.repinRequested = false;
        out.push({ ...pin });
      }
      return out;
    },
    async finishUnpin(cid, now = new Date()) {
      const pin = pins.get(cid);
      if (!pin) return { repin: false };
      const repin = pin.repinRequested;
      Object.assign(pin, { status: 'UNPINNED', unpinnedAt: now });
      return { repin };
    },
    async restorePinned(cid, error) {
      const pin = pins.get(cid);
      if (pin && pin.status === 'UNPIN_PENDING') Object.assign(pin, { status: 'PINNED', repinRequested: false, lastError: error ?? null });
    },
    async get(cid) {
      const pin = pins.get(cid);
      return pin ? { ...pin } : null;
    },
    async refsFor(cid) {
      return refs.filter((r) => r.cid === cid).map((r) => ({ ...r }));
    },
    async importPin({ cid, sha256, size, provider, pinnedAt }) {
      if (pins.has(cid)) return false;
      pins.set(cid, {
        cid, sha256: sha256 ?? '', size, provider, status: 'PINNED', repinRequested: false,
        pinnedAt: pinnedAt ?? new Date(), unpinnedAt: null, lastError: null,
      });
      return true;
    },
    async addRef(owner, cid, state = 'CANDIDATE', anchor = null) {
      if (!find({ cid, ownerKind: owner.kind, ownerId: owner.id })) {
        refs.push({ cid, ownerKind: owner.kind, ownerId: owner.id, state, anchor });
      }
    },
  };
  return ledger;
}

// ───────────────────────────────── seam + helpers ──────────────────────────

let ledger: PinLedger = postgresPinLedger;

export function getPinLedger(): PinLedger {
  return ledger;
}

/** Test seam. Returns the previous ledger. */
export function setPinLedger(next: PinLedger): PinLedger {
  const prev = ledger;
  ledger = next;
  return prev;
}

/**
 * Marks the owner's pin references ANCHORED (the owner is now on chain). Never
 * throws: a missed anchor is repaired by the GC's reconciliation pass, and
 * failing the caller here would break the on-chain link it is recording.
 */
export async function anchorRefs(kind: PinOwnerKind, id: string, anchor: string): Promise<number> {
  try {
    return await ledger.anchor({ kind, id }, anchor);
  } catch {
    return 0;
  }
}
