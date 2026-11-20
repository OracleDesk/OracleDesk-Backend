SET lock_timeout = '5s';

CREATE TABLE "copy_trade_audits" (
  "id" TEXT NOT NULL,
  "copyTradeId" TEXT NOT NULL,
  "fromStatus" "CopyTradeStatus" NOT NULL,
  "toStatus" "CopyTradeStatus" NOT NULL,
  "txHash" TEXT NOT NULL,
  "chainEventId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "copy_trade_audits_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "copy_trade_audits_copyTradeId_fkey"
    FOREIGN KEY ("copyTradeId") REFERENCES "copy_trades"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "copy_trade_audits_copyTradeId_createdAt_idx"
ON "copy_trade_audits"("copyTradeId", "createdAt");

CREATE TABLE "copy_trade_ambiguities" (
  "id" TEXT NOT NULL,
  "chainEventId" TEXT NOT NULL,
  "txHash" TEXT NOT NULL,
  "candidateCopyTradeIds" JSONB NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "copy_trade_ambiguities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "copy_trade_ambiguities_chainEventId_key"
ON "copy_trade_ambiguities"("chainEventId");
CREATE INDEX "copy_trade_ambiguities_createdAt_idx"
ON "copy_trade_ambiguities"("createdAt");
