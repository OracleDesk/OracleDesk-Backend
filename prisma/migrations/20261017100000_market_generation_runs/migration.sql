-- Market generation saga runs table and state enum (Issue #152)
-- Forward-only migration. Does not alter existing table structures.

CREATE TYPE "GenerationRunState" AS ENUM (
  'STARTED',
  'SIGNALS_READY',
  'PROPOSED',
  'MARKET_PERSISTED',
  'QUESTION_PINNED',
  'CHAIN_SUBMITTED',
  'CHAIN_CONFIRMED',
  'TRACE_PERSISTED',
  'TRACE_PINNED',
  'TRACE_PUBLISHED',
  'COMPLETED',
  'SKIPPED',
  'NEEDS_ATTENTION',
  'CANCELLED'
);

CREATE TABLE "market_generation_runs" (
  "id" TEXT NOT NULL,
  "trigger" TEXT NOT NULL,
  "state" "GenerationRunState" NOT NULL DEFAULT 'STARTED',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3),
  "lockedBy" TEXT,
  "lockedUntil" TIMESTAMP(3),
  "inputs" JSONB,
  "outputs" JSONB NOT NULL DEFAULT '{}',
  "marketId" TEXT,
  "lastError" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "market_generation_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "market_generation_runs_marketId_key" UNIQUE ("marketId"),
  CONSTRAINT "market_generation_runs_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "markets"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "market_generation_runs_state_nextAttemptAt_idx" ON "market_generation_runs"("state", "nextAttemptAt");
