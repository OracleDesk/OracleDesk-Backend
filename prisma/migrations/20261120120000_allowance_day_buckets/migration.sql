-- Allowance day buckets and durable charges (#219).
-- Expand-only: two new tables, backfilled from confirmed payment_events, plus
-- the payment_events."reconciled" column the schema has declared since #56
-- but no migration created (the Prisma model had also lost its
-- @@map("payment_events"), so the client could not reach the table).
SET lock_timeout = '5s';

ALTER TABLE "payment_events"
    ADD COLUMN IF NOT EXISTS "reconciled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "allowance_days" (
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "spentRaw" DECIMAL(39,0) NOT NULL DEFAULT 0,
    "reservedRaw" DECIMAL(39,0) NOT NULL DEFAULT 0,
    "overageRaw" DECIMAL(39,0) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "allowance_days_pkey" PRIMARY KEY ("userId","day"),
    CONSTRAINT "allowance_days_amounts_nonneg"
        CHECK ("spentRaw" >= 0 AND "reservedRaw" >= 0 AND "overageRaw" >= 0)
);

CREATE TABLE "allowance_charges" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "txHash" TEXT,
    "reservationKey" TEXT,
    "traceId" TEXT,
    "amountRaw" DECIMAL(39,0) NOT NULL,
    "overageRaw" DECIMAL(39,0) NOT NULL DEFAULT 0,
    "perTraceExceeded" BOOLEAN NOT NULL DEFAULT false,
    "dayInferred" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allowance_charges_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "allowance_charges_source_values"
        CHECK ("source" IN ('PASS_CLAIM', 'PAYMENT_INTENT', 'X402')),
    CONSTRAINT "allowance_charges_status_values"
        CHECK ("status" IN ('RESERVED', 'COMMITTED', 'RELEASED', 'EXPIRED')),
    CONSTRAINT "allowance_charges_reserved_expiry"
        CHECK ("status" <> 'RESERVED' OR "expiresAt" IS NOT NULL),
    CONSTRAINT "allowance_charges_tx_hash_format"
        CHECK ("txHash" IS NULL OR "txHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "allowance_charges_amounts_nonneg"
        CHECK ("amountRaw" >= 0 AND "overageRaw" >= 0)
);

CREATE UNIQUE INDEX "allowance_charges_txHash_key" ON "allowance_charges"("txHash");
CREATE UNIQUE INDEX "allowance_charges_reservationKey_key" ON "allowance_charges"("reservationKey");
CREATE INDEX "allowance_charges_userId_day_idx" ON "allowance_charges"("userId", "day");
CREATE INDEX "allowance_charges_status_expiresAt_idx" ON "allowance_charges"("status", "expiresAt");

ALTER TABLE "allowance_days" ADD CONSTRAINT "allowance_days_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "allowance_charges" ADD CONSTRAINT "allowance_charges_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: one COMMITTED charge per confirmed pass/trace payment, on the UTC
-- day of its ledger close time (falling back to confirmation, then creation
-- time, with dayInferred set). Timestamps are stored as UTC, so ::date is the
-- UTC day. Overage is copied as stored, never recomputed. Unapplied
-- payment-intent transfers (metadata.noCoverage) were never charged to the
-- allowance and stay out.
WITH confirmed AS (
    SELECT
        pe.*,
        pe."amountRaw"::numeric AS "exactRaw",
        ROUND(pe."amount"::numeric * 10000000) AS "floatRaw"
    FROM "payment_events" pe
    WHERE pe."status" = 'CONFIRMED'
      AND pe."type" IN ('DAILY_PASS', 'PER_TRACE')
      AND pe."amount" >= 0
      AND COALESCE(pe."metadata"->>'noCoverage', 'false') <> 'true'
),
paid AS (
    SELECT c.*, COALESCE(c."exactRaw", c."floatRaw") AS "raw" FROM confirmed c
)
INSERT INTO "allowance_charges" (
    "id", "userId", "day", "source", "status", "txHash", "traceId",
    "amountRaw", "overageRaw", "perTraceExceeded", "dayInferred", "createdAt", "updatedAt"
)
SELECT
    gen_random_uuid()::text,
    p."userId",
    COALESCE(p."ledgerCloseTime", p."confirmedAt", p."createdAt")::date,
    CASE WHEN p."paymentIntentId" IS NOT NULL THEN 'PAYMENT_INTENT' ELSE 'PASS_CLAIM' END,
    'COMMITTED',
    CASE WHEN lower(p."txHash") ~ '^[0-9a-f]{64}$' THEN lower(p."txHash") END,
    p."traceId",
    p."raw",
    LEAST(COALESCE(p."allowanceOverageRaw", 0), p."raw"),
    COALESCE(p."metadata"->>'perTraceExceeded', 'false') = 'true',
    p."ledgerCloseTime" IS NULL,
    COALESCE(p."confirmedAt", p."createdAt"),
    CURRENT_TIMESTAMP
FROM paid p
ON CONFLICT ("txHash") DO NOTHING;

-- Buckets: what was booked within the limit (amount minus stored overage) and
-- the stored overage, per user and day.
INSERT INTO "allowance_days" ("userId", "day", "spentRaw", "reservedRaw", "overageRaw", "updatedAt")
SELECT
    "userId",
    "day",
    SUM("amountRaw" - "overageRaw"),
    0,
    SUM("overageRaw"),
    CURRENT_TIMESTAMP
FROM "allowance_charges"
WHERE "status" = 'COMMITTED'
GROUP BY "userId", "day"
ON CONFLICT ("userId", "day") DO NOTHING;
