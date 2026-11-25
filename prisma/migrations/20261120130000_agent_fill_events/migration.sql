-- Add post-trade reserves, fill ledger, and fill mismatch tracking for agent fills (#303).
ALTER TABLE "trades"
  ADD COLUMN IF NOT EXISTS "reserveYesRaw" DECIMAL(39, 0),
  ADD COLUMN IF NOT EXISTS "reserveNoRaw" DECIMAL(39, 0),
  ADD COLUMN IF NOT EXISTS "fillLedger" INTEGER,
  ADD COLUMN IF NOT EXISTS "fillMismatch" JSONB;

ALTER TABLE "position_exits"
  ADD COLUMN IF NOT EXISTS "feeRaw" DECIMAL(39, 0),
  ADD COLUMN IF NOT EXISTS "reserveYesRaw" DECIMAL(39, 0),
  ADD COLUMN IF NOT EXISTS "reserveNoRaw" DECIMAL(39, 0),
  ADD COLUMN IF NOT EXISTS "fillLedger" INTEGER,
  ADD COLUMN IF NOT EXISTS "fillMismatch" JSONB;
