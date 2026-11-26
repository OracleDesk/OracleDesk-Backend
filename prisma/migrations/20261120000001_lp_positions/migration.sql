CREATE TABLE "lp_positions" (
  "marketId" TEXT NOT NULL,
  "onChainMarketId" BIGINT NOT NULL,
  "seedRaw" DECIMAL(39,0) NOT NULL,
  "openBps" INTEGER NOT NULL,
  "creatorYesRaw" DECIMAL(39,0) NOT NULL,
  "creatorNoRaw" DECIMAL(39,0) NOT NULL,
  "protocolShareBps" INTEGER,
  "lpFeesAccruedRaw" DECIMAL(39,0) NOT NULL DEFAULT 0,
  "lpFeesOnChainRaw" DECIMAL(39,0),
  "lpFeesClaimedRaw" DECIMAL(39,0) NOT NULL DEFAULT 0,
  "markValueRaw" DECIMAL(39,0),
  "settledValueRaw" DECIMAL(39,0),
  "expectedLpLossRaw" DECIMAL(39,0),
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "lastEventLedger" INTEGER,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "lp_positions_pkey" PRIMARY KEY ("marketId"),
  CONSTRAINT "lp_positions_onChainMarketId_key" UNIQUE ("onChainMarketId"),
  CONSTRAINT "lp_positions_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "markets"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "lp_positions_status_idx" ON "lp_positions"("status");
