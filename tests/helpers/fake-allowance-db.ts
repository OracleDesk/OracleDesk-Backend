/**
 * In-memory Prisma double for the allowance ledger (#219): users, spending
 * allowances, allowance_days buckets, allowance_charges, and the
 * subscription/payment_event writes settleVerifiedTransfer makes. It covers
 * exactly the delegate calls and raw SQL the allowance code issues (bucket
 * INSERT ... ON CONFLICT / SELECT ... FOR UPDATE, the charge row lock, the
 * expiry sweep's SKIP LOCKED batch and the advisory locks). Transactions run
 * sequentially, so row locks are no-ops here; lock behaviour itself is
 * covered by the integration suite.
 */

type Row = Record<string, any>;

export interface FakeAllowanceDb {
  users: Row[];
  allowances: Map<string, Row>;
  days: Map<string, Row>;
  charges: Row[];
  subscriptions: Row[];
  paymentEvents: Row[];
  client: any;
  /** Today's (or `day`'s) bucket as bigint strings, zeros when absent. */
  bucket(userId: string, day: Date | string): { spentRaw: string; reservedRaw: string; overageRaw: string } | null;
  install(prisma: any): () => void;
}

const dayKey = (d: Date | string) => (typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10));
const str = (v: unknown) => (v == null ? v : String(v));

function applyData(row: Row, data: Row): void {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && 'increment' in (v as Row)) {
      row[k] = (BigInt(row[k] ?? 0) + BigInt((v as Row).increment)).toString();
    } else {
      row[k] = v;
    }
  }
}

function uniqueViolation(target: string): Error {
  return Object.assign(new Error(`Unique constraint failed on ${target}`), { code: 'P2002' });
}

export function fakeAllowanceDb(): FakeAllowanceDb {
  const users: Row[] = [];
  const allowances = new Map<string, Row>();
  const days = new Map<string, Row>();
  const charges: Row[] = [];
  const subscriptions: Row[] = [];
  const paymentEvents: Row[] = [];
  let seq = 0;

  const ensureDay = (userId: string, key: string) => {
    const k = `${userId}|${key}`;
    if (!days.has(k)) {
      days.set(k, { userId, day: new Date(`${key}T00:00:00.000Z`), spentRaw: '0', reservedRaw: '0', overageRaw: '0' });
    }
    return days.get(k)!;
  };

  const raw = async (strings: TemplateStringsArray, ...values: any[]) => {
    const sql = strings.join('?');
    if (sql.includes('pg_try_advisory_xact_lock')) return [{ locked: true }];
    if (sql.includes('INSERT INTO "allowance_days"')) {
      ensureDay(values[0], values[1]);
      return 1;
    }
    if (sql.includes('FROM "allowance_days"') && sql.includes('FOR UPDATE')) {
      const row = days.get(`${values[0]}|${values[1]}`);
      return row ? [{ ...row }] : [];
    }
    if (sql.includes('FROM "allowance_charges"') && sql.includes('SKIP LOCKED')) {
      const [now, limit] = values as [Date, number];
      return charges
        .filter((c) => c.status === 'RESERVED' && c.expiresAt && c.expiresAt < now)
        .slice(0, limit)
        .map((c) => ({ id: c.id, userId: c.userId, day: c.day, amountRaw: c.amountRaw }));
    }
    if (sql.includes('FROM "allowance_charges"') && sql.includes('FOR UPDATE')) {
      return charges.filter((c) => c.id === values[0]).map((c) => ({ id: c.id }));
    }
    throw new Error(`fakeAllowanceDb: unhandled SQL: ${sql}`);
  };

  const findCharge = (where: Row) =>
    charges.find((c) =>
      (where.id !== undefined && c.id === where.id) ||
      (where.txHash !== undefined && c.txHash === where.txHash) ||
      (where.reservationKey !== undefined && c.reservationKey === where.reservationKey),
    ) ?? null;

  const client: any = {
    $queryRaw: raw,
    $executeRaw: raw,
    user: {
      findUnique: async ({ where }: any) =>
        users.find((u) => (where.id && u.id === where.id) || (where.identityKey && u.identityKey === where.identityKey)) ?? null,
    },
    spendingAllowance: {
      findUnique: async ({ where }: any) => {
        const a = allowances.get(where.userId);
        return a ? { ...a } : null;
      },
      update: async ({ where, data }: any) => {
        const a = allowances.get(where.userId);
        if (!a) throw new Error('allowance not found');
        applyData(a, data);
        return { ...a };
      },
    },
    allowanceDay: {
      findUnique: async ({ where }: any) => {
        const row = days.get(`${where.userId_day.userId}|${dayKey(where.userId_day.day)}`);
        return row ? { ...row } : null;
      },
      update: async ({ where, data }: any) => {
        const row = days.get(`${where.userId_day.userId}|${dayKey(where.userId_day.day)}`);
        if (!row) throw new Error('allowance_days row not found');
        applyData(row, data);
        return { ...row };
      },
    },
    allowanceCharge: {
      findUnique: async ({ where }: any) => {
        const c = findCharge(where);
        return c ? { ...c } : null;
      },
      findMany: async ({ where }: any = {}) =>
        charges.filter((c) => !where || Object.entries(where).every(([k, v]) => c[k] === v)).map((c) => ({ ...c })),
      create: async ({ data }: any) => {
        if (data.txHash && charges.some((c) => c.txHash === data.txHash)) throw uniqueViolation('txHash');
        if (data.reservationKey && charges.some((c) => c.reservationKey === data.reservationKey)) throw uniqueViolation('reservationKey');
        const row = {
          id: `charge-${++seq}`,
          overageRaw: '0',
          perTraceExceeded: false,
          dayInferred: false,
          txHash: null,
          reservationKey: null,
          traceId: null,
          expiresAt: null,
          createdAt: new Date(),
          ...data,
          amountRaw: str(data.amountRaw),
        };
        charges.push(row);
        return { ...row };
      },
      update: async ({ where, data }: any) => {
        const row = charges.find((c) => c.id === where.id);
        if (!row) throw new Error('charge not found');
        if (data.txHash && charges.some((c) => c !== row && c.txHash === data.txHash)) throw uniqueViolation('txHash');
        applyData(row, data);
        return { ...row };
      },
    },
    subscription: {
      findFirst: async ({ where }: any = {}) =>
        subscriptions.find((s) => where?.txHash === undefined || s.txHash === where.txHash) ?? null,
      create: async ({ data }: any) => {
        const s = { id: `sub-${++seq}`, ...data };
        subscriptions.push(s);
        return s;
      },
    },
    paymentEvent: {
      findUnique: async ({ where }: any) => paymentEvents.find((p) => p.txHash === where.txHash) ?? null,
      create: async ({ data }: any) => {
        if (paymentEvents.some((p) => p.txHash === data.txHash)) throw uniqueViolation('txHash');
        const p = { id: `pe-${++seq}`, ...data };
        paymentEvents.push(p);
        return p;
      },
    },
  };
  client.$transaction = async (fn: any) => fn(client);

  return {
    users,
    allowances,
    days,
    charges,
    subscriptions,
    paymentEvents,
    client,
    bucket(userId, day) {
      const row = days.get(`${userId}|${dayKey(day)}`);
      return row ? { spentRaw: str(row.spentRaw)!, reservedRaw: str(row.reservedRaw)!, overageRaw: str(row.overageRaw)! } : null;
    },
    install(prisma: any) {
      const saved: Array<[any, string, any]> = [];
      const patch = (target: any, key: string, value: any) => {
        saved.push([target, key, target[key]]);
        target[key] = value;
      };
      patch(prisma, '$transaction', client.$transaction);
      for (const model of ['user', 'spendingAllowance', 'allowanceDay', 'allowanceCharge', 'subscription', 'paymentEvent']) {
        for (const [name, fn] of Object.entries(client[model])) patch(prisma[model], name, fn);
      }
      return () => {
        for (const [target, key, value] of saved.reverse()) target[key] = value;
      };
    },
  };
}

/** A user plus an active allowance with the given raw limits. */
export function seedAllowance(
  db: FakeAllowanceDb,
  opts: { userId: string; identityKey?: string; dailyLimitRaw: bigint; perTraceLimitRaw: bigint; windowStartedAt?: Date },
): void {
  db.users.push({ id: opts.userId, identityKey: opts.identityKey ?? opts.userId, walletAddress: opts.identityKey ?? opts.userId });
  db.allowances.set(opts.userId, {
    userId: opts.userId,
    isActive: true,
    dailyLimitRaw: opts.dailyLimitRaw.toString(),
    perTraceLimitRaw: opts.perTraceLimitRaw.toString(),
    spentTodayRaw: '0',
    spentToday: 0,
    overageRaw: '0',
    windowStartedAt: opts.windowStartedAt ?? new Date(0),
    lastResetAt: new Date(0),
  });
}
