-- Agent execution quality reports (#295): quotes, confirmed fills, shortfall
-- decomposition, and SlippageExceeded accounting per liquidity bucket.
SET lock_timeout = '5s';

CREATE TABLE "execution_reports" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "tradeId" TEXT,
    "positionExitId" TEXT,
    "marketId" TEXT NOT NULL,
    "direction" "TradeDirection" NOT NULL,
    "decisionLedger" INTEGER,
    "decisionMidBps" INTEGER,
    "slippageBoundBps" INTEGER NOT NULL,
    "quotes" JSONB NOT NULL DEFAULT '[]',
    "quoteCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "failureCode" TEXT,
    "landedTxHash" TEXT,
    "fillLedger" INTEGER,
    "ledgerDelay" INTEGER,
    "fillCollateralRaw" DECIMAL(39,0),
    "fillSharesRaw" DECIMAL(39,0),
    "fillFeeRaw" DECIMAL(39,0),
    "fillPriceBps" INTEGER,
    "postReserveYesRaw" DECIMAL(39,0),
    "postReserveNoRaw" DECIMAL(39,0),
    "liquidityBucket" TEXT,
    "delayBps" INTEGER,
    "impactBps" INTEGER,
    "feeBps" INTEGER,
    "residualBps" INTEGER,
    "totalShortfallBps" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "execution_reports_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "execution_reports_kind_values"
        CHECK ("kind" IN ('BUY', 'SELL')),
    CONSTRAINT "execution_reports_status_values"
        CHECK ("status" IN ('PENDING', 'CONFIRMED', 'SLIPPAGE_EXCEEDED', 'FAILED'))
);

CREATE UNIQUE INDEX "execution_reports_tradeId_key" ON "execution_reports"("tradeId");
CREATE UNIQUE INDEX "execution_reports_positionExitId_key" ON "execution_reports"("positionExitId");
CREATE INDEX "execution_reports_marketId_createdAt_idx" ON "execution_reports"("marketId", "createdAt");
CREATE INDEX "execution_reports_status_liquidityBucket_idx" ON "execution_reports"("status", "liquidityBucket");
CREATE INDEX "execution_reports_landedTxHash_idx" ON "execution_reports"("landedTxHash");
