-- Phase A (expand) of the payment/allowance float removal (#224).
-- Additive only: every statement is safe while older instances still run.
-- The matching contract migration lives in prisma/migrations-pending/ and is
-- promoted only after phase B is deployed everywhere and the backfill is clean
-- (docs/runbooks/payments-float-contract.md).
SET lock_timeout = '5s';

-- Exact twin of subscriptions.amountPaid. Nullable until the backfill fills
-- legacy rows; the CHECK is validated by the contract migration.
ALTER TABLE "subscriptions" ADD COLUMN "amountPaidRaw" NUMERIC(39,0);
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_amount_paid_raw_nonneg"
    CHECK ("amountPaidRaw" IS NULL OR "amountPaidRaw" >= 0) NOT VALID;

-- With PAYMENT_FLOAT_WRITES=false writers omit the float mirrors, so every
-- NOT NULL float needs a default for inserts to succeed. 0 satisfies the
-- existing *_nonneg CHECKs; readers never treat it as a real amount.
ALTER TABLE "subscriptions" ALTER COLUMN "amountPaid" SET DEFAULT 0;
ALTER TABLE "payment_events" ALTER COLUMN "amount" SET DEFAULT 0;
ALTER TABLE "spending_allowances"
    ALTER COLUMN "dailyLimit" SET DEFAULT 0,
    ALTER COLUMN "perTraceLimit" SET DEFAULT 0;

-- The #56 reconciliation flag was added to the Prisma model without a
-- migration. PaymentEvent now maps to "payment_events" (@@map), so Prisma
-- selects the column on every read; create it if it is missing.
ALTER TABLE "payment_events" ADD COLUMN IF NOT EXISTS "reconciled" BOOLEAN NOT NULL DEFAULT false;

-- Per-row outcome of scripts/backfill-payment-raw.ts. New, empty table.
CREATE TABLE "payment_raw_backfill" (
    "table" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "floatValue" DOUBLE PRECISION,
    "rawValue" NUMERIC(39,0),
    "chainValue" NUMERIC(39,0),
    "status" TEXT NOT NULL,
    "detail" TEXT,
    "applied" BOOLEAN NOT NULL DEFAULT false,
    "checkedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_raw_backfill_pkey" PRIMARY KEY ("table", "rowId"),
    CONSTRAINT "payment_raw_backfill_status_check"
        CHECK ("status" IN ('VERIFIED', 'FLOAT_ONLY', 'MISMATCH', 'NOT_FOUND'))
);
