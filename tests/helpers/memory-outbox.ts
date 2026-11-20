import type { ChainTransactionRow as Row, OutboxStore as Store } from '../../src/services/stellar/outbox';

/**
 * In-memory OutboxStore with compare-and-set transitions and a status history,
 * shared by the outbox (#35) and admin outbox console (#221) tests.
 */

export const blankRow = (): Omit<Row, 'id' | 'kind'> => ({
  refId: null, contract: null, method: null, args: null, simulated: null, source: null,
  sequence: null, hash: null, envelopeXdr: null, status: 'BUILT', submitLedger: null,
  minTime: null, maxTime: null, ledger: null, resultXdr: null, returnValue: null,
  innerFee: null, resourceFee: null, feeBumpHashes: [], feeBumpEnvelopes: null,
  landedHash: null, bumpAttempts: 0, attempts: 0, error: null, handledAt: null,
  updatedAt: new Date(0),
});

export type MemoryStore = Store & {
  rows: Map<string, Row>;
  history: string[];
  seed(data: Partial<Row> & { kind: string }): Row;
  /** The handledAt compare-and-set the admin rerun-handler uses. */
  clearHandled(id: string, handledAt: Date): Promise<boolean>;
};

export function memoryStore(): MemoryStore {
  const rows = new Map<string, Row>();
  let n = 0;
  const history: string[] = [];
  const terminal = ['SUCCESS', 'FAILED', 'EXPIRED'];
  const store: MemoryStore = {
    rows,
    history,
    seed(data) {
      const row: Row = { ...blankRow(), id: `ob${++n}`, ...data } as Row;
      rows.set(row.id, row);
      return row;
    },
    async create(data) {
      const row = store.seed(data);
      history.push(`${row.id}:${row.status}`);
      return { ...row };
    },
    async transition(id, from, to, patch = {}) {
      const row = rows.get(id);
      if (!row || !from.includes(row.status as never)) return null;
      Object.assign(row, patch, { status: to, updatedAt: new Date() });
      history.push(`${id}:${to}`);
      return { ...row };
    },
    async findInFlight(now, graceMs) {
      const cutoff = now.getTime() - graceMs;
      return [...rows.values()]
        .filter((r) =>
          r.status === 'SUBMITTED' || r.status === 'PENDING'
            ? true
            : (r.status === 'BUILT' || r.status === 'SIGNED') && (r.updatedAt?.getTime() ?? 0) < cutoff,
        )
        .map((r) => ({ ...r }));
    },
    async findUnhandled() {
      return [...rows.values()].filter((r) => terminal.includes(r.status) && !r.handledAt).map((r) => ({ ...r }));
    },
    async findByAnyHash(hashes) {
      const row = [...rows.values()].find(
        (r) => (r.hash && hashes.includes(r.hash)) || (r.landedHash && hashes.includes(r.landedHash)) || r.feeBumpHashes.some((h) => hashes.includes(h)),
      );
      return row ? { ...row } : null;
    },
    async findById(id) {
      const row = rows.get(id);
      return row ? { ...row } : null;
    },
    async markHandled(id) {
      const row = rows.get(id);
      if (row && !row.handledAt) row.handledAt = new Date();
    },
    async recordBump(row, outerHash, envelope) {
      const live = rows.get(row.id);
      if (!live || live.bumpAttempts !== row.bumpAttempts) return false;
      live.bumpAttempts += 1;
      live.feeBumpHashes = [...live.feeBumpHashes, outerHash];
      live.feeBumpEnvelopes = [...((live.feeBumpEnvelopes as unknown[]) ?? []), envelope];
      return true;
    },
    async recordError(id, error) {
      const row = rows.get(id);
      if (row) row.error = error;
    },
    async clearHandled(id, handledAt) {
      const row = rows.get(id);
      if (!row || !row.handledAt || row.handledAt.getTime() !== handledAt.getTime()) return false;
      row.handledAt = null;
      return true;
    },
  };
  return store;
}
