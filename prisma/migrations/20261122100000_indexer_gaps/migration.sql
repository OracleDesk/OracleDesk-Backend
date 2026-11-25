-- Indexer ledger gaps (#10): record gaps instead of skipping past RPC retention
SET lock_timeout = '5s';

CREATE TABLE "indexer_gaps" (
    "id" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "fromLedger" INTEGER NOT NULL,
    "toLedger" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "detectedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMPTZ(3),
    "resolvedBy" TEXT,
    "note" TEXT,

    CONSTRAINT "indexer_gaps_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "indexer_gaps_network_fromLedger_toLedger_key" ON "indexer_gaps"("network", "fromLedger", "toLedger");
CREATE INDEX "indexer_gaps_network_resolvedAt_idx" ON "indexer_gaps"("network", "resolvedAt");
