-- Migration: 20261020000000_price_market_monitoring (#309)
-- Adds price_feed_checks, price_close_snapshots, price_resolution_checks,
-- and generalizes alert_deliveries with nullable reviewId + subjectId.
SET lock_timeout = '5s';

ALTER TABLE "alert_deliveries" ALTER COLUMN "reviewId" DROP NOT NULL;
ALTER TABLE "alert_deliveries" ADD COLUMN IF NOT EXISTS "subjectId" TEXT;
UPDATE "alert_deliveries" SET "subjectId" = "reviewId" WHERE "subjectId" IS NULL AND "reviewId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "alert_deliveries_subjectId_idx" ON "alert_deliveries"("subjectId");

CREATE TABLE IF NOT EXISTS "price_feed_checks" (
    "id" TEXT NOT NULL,
    "market_id" TEXT NOT NULL,
    "checked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ledger" INTEGER NOT NULL,
    "health" JSONB NOT NULL,
    "severity" TEXT NOT NULL,

    CONSTRAINT "price_feed_checks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "price_feed_checks_market_id_checked_at_idx" ON "price_feed_checks"("market_id", "checked_at");
CREATE INDEX IF NOT EXISTS "price_feed_checks_severity_checked_at_idx" ON "price_feed_checks"("severity", "checked_at");

CREATE TABLE IF NOT EXISTS "price_close_snapshots" (
    "id" TEXT NOT NULL,
    "market_id" TEXT NOT NULL,
    "close_time" BIGINT NOT NULL,
    "records" JSONB NOT NULL,
    "ledger" INTEGER NOT NULL,
    "read_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_close_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "price_close_snapshots_market_id_key" ON "price_close_snapshots"("market_id");

CREATE TABLE IF NOT EXISTS "price_resolution_checks" (
    "id" TEXT NOT NULL,
    "market_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "checked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_resolution_checks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "price_resolution_checks_market_id_key" ON "price_resolution_checks"("market_id");
CREATE INDEX IF NOT EXISTS "price_resolution_checks_verdict_checked_at_idx" ON "price_resolution_checks"("verdict", "checked_at");
