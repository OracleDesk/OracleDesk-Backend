-- Phase C (contract) of the payment/allowance float removal (#224).
--
-- NOT APPLIED YET. This file lives outside prisma/migrations on purpose so
-- `prisma migrate deploy` cannot run it alongside phase A. Promote it only
-- when every precondition in docs/runbooks/payments-float-contract.md holds:
-- phase B deployed on every instance, PAYMENT_FLOAT_WRITES=false everywhere,
-- and scripts/backfill-payment-raw.ts reporting zero MISMATCH and no NULL raw
-- values. It intentionally fails scripts/check-migration-compat.mjs and ships
-- under the `migration:breaking` label with --allow-breaking.
SET lock_timeout = '5s';

-- Dropping a column also drops the float *_nonneg CHECK constraints on it.
ALTER TABLE "subscriptions" DROP COLUMN "amountPaid";
ALTER TABLE "payment_events" DROP COLUMN "amount";
ALTER TABLE "spending_allowances"
    DROP COLUMN "dailyLimit",
    DROP COLUMN "perTraceLimit",
    DROP COLUMN "spentToday";

ALTER TABLE "subscriptions" VALIDATE CONSTRAINT "subscriptions_amount_paid_raw_nonneg";
