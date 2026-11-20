-- Market generation saga: per-run fencing token and cycle id (#242).
-- Forward-only; additive columns with defaults.
SET lock_timeout = '5s';
ALTER TABLE "market_generation_runs" ADD COLUMN "fence" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "market_generation_runs" ADD COLUMN "cycleId" TEXT;
