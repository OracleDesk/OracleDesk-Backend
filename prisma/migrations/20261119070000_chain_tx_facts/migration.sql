-- Immutable chain transaction facts cache for verify-then-settle payments (#305).
SET lock_timeout = '5s';

CREATE TABLE "chain_tx_facts" (
  "txHash" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "ledger" INTEGER NOT NULL,
  "facts" JSONB NOT NULL,
  "fetchedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chain_tx_facts_pkey" PRIMARY KEY ("txHash")
);
