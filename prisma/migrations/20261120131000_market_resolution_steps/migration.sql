-- Add market_resolution_steps table for outbox-tracked resolver writes (#297).
CREATE TABLE IF NOT EXISTS "market_resolution_steps" (
  "id" TEXT NOT NULL,
  "marketId" TEXT NOT NULL,
  "step" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3),
  "escalatedAt" TIMESTAMP(3),
  "txHash" TEXT,
  "ledger" INTEGER,
  "outcome" TEXT,
  "failureCode" TEXT,
  "landedBy" TEXT,
  "lastOutboxId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "market_resolution_steps_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "market_resolution_steps_marketId_fkey"
    FOREIGN KEY ("marketId") REFERENCES "markets"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "market_resolution_steps_marketId_step_key"
  ON "market_resolution_steps"("marketId", "step");

CREATE INDEX IF NOT EXISTS "market_resolution_steps_step_status_nextAttemptAt_idx"
  ON "market_resolution_steps"("step", "status", "nextAttemptAt");
