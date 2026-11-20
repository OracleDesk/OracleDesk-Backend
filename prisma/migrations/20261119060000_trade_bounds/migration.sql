-- Execution bounds for agent trades and exits (#245).
-- Expand-only: nullable columns; CHECKs added NOT VALID (existing rows are NULL).
SET lock_timeout = '5s';

ALTER TABLE "trades"
  ADD COLUMN "limitPriceBps" INTEGER,
  ADD COLUMN "deadline" BIGINT,
  ADD COLUMN "decisionLedger" INTEGER;
ALTER TABLE "trades"
  ADD CONSTRAINT "trades_limit_price_bps_range"
  CHECK ("limitPriceBps" IS NULL OR ("limitPriceBps" >= 1 AND "limitPriceBps" <= 10000))
  NOT VALID;

ALTER TABLE "position_exits"
  ADD COLUMN "limitPriceBps" INTEGER,
  ADD COLUMN "deadline" BIGINT,
  ADD COLUMN "decisionLedger" INTEGER;
ALTER TABLE "position_exits"
  ADD CONSTRAINT "position_exits_limit_price_bps_range"
  CHECK ("limitPriceBps" IS NULL OR ("limitPriceBps" >= 1 AND "limitPriceBps" <= 10000))
  NOT VALID;
