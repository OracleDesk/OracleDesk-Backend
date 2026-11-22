-- Migration: 20261020010000_fee_receipts (#308)
-- Additive fee receipt columns on chain_fees and op_class on chain_transactions.
-- Existing chain_fees rows retain source = 'ESTIMATE'.
SET lock_timeout = '5s';

ALTER TABLE "chain_transactions"
    ADD COLUMN IF NOT EXISTS "op_class" TEXT;

ALTER TABLE "chain_fees"
    ADD COLUMN IF NOT EXISTS "outbox_id" TEXT,
    ADD COLUMN IF NOT EXISTS "landed_hash" TEXT,
    ADD COLUMN IF NOT EXISTS "payer" TEXT,
    ADD COLUMN IF NOT EXISTS "fee_bumped" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "success" BOOLEAN,
    ADD COLUMN IF NOT EXISTS "inner_fee_charged" BIGINT,
    ADD COLUMN IF NOT EXISTS "non_refundable_charged" BIGINT,
    ADD COLUMN IF NOT EXISTS "refundable_charged" BIGINT,
    ADD COLUMN IF NOT EXISTS "rent_charged" BIGINT,
    ADD COLUMN IF NOT EXISTS "declared_fee" BIGINT,
    ADD COLUMN IF NOT EXISTS "ledger" INTEGER,
    ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'ESTIMATE';

CREATE INDEX IF NOT EXISTS "chain_fees_payer_created_at_idx" ON "chain_fees"("payer", "created_at");
CREATE INDEX IF NOT EXISTS "chain_fees_outbox_id_idx" ON "chain_fees"("outbox_id");
