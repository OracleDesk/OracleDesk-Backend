-- Per-wallet trading PnL ledger and leaderboard projections (Issue #155)
-- Forward-only migration.

CREATE TABLE "wallet_positions" (
  "wallet" TEXT NOT NULL,
  "onChainMarketId" BIGINT NOT NULL,
  "outcome" TEXT NOT NULL,
  "shares" DECIMAL(39, 0) NOT NULL DEFAULT 0,
  "costBasis" DECIMAL(39, 0) NOT NULL DEFAULT 0,
  "realizedPnl" DECIMAL(39, 0) NOT NULL DEFAULT 0,
  "boughtCollateral" DECIMAL(39, 0) NOT NULL DEFAULT 0,
  "soldCollateral" DECIMAL(39, 0) NOT NULL DEFAULT 0,
  "feesPaid" DECIMAL(39, 0) NOT NULL DEFAULT 0,
  "redeemed" DECIMAL(39, 0) NOT NULL DEFAULT 0,
  "tradeCount" INTEGER NOT NULL DEFAULT 0,
  "lastEventId" TEXT NOT NULL DEFAULT '',
  "settled" BOOLEAN NOT NULL DEFAULT false,
  "incomplete" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "wallet_positions_pkey" PRIMARY KEY ("wallet", "onChainMarketId", "outcome")
);

CREATE INDEX "wallet_positions_onChainMarketId_idx" ON "wallet_positions"("onChainMarketId");

CREATE TABLE "wallet_stats_daily" (
  "wallet" TEXT NOT NULL,
  "day" DATE NOT NULL,
  "category" TEXT NOT NULL,
  "volume" DECIMAL(39, 0) NOT NULL DEFAULT 0,
  "realizedPnl" DECIMAL(39, 0) NOT NULL DEFAULT 0,
  "fees" DECIMAL(39, 0) NOT NULL DEFAULT 0,
  "trades" INTEGER NOT NULL DEFAULT 0,
  "wins" INTEGER NOT NULL DEFAULT 0,
  "losses" INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT "wallet_stats_daily_pkey" PRIMARY KEY ("wallet", "day", "category")
);

CREATE INDEX "wallet_stats_daily_day_idx" ON "wallet_stats_daily"("day");

CREATE TABLE "wallet_events_applied" (
  "eventId" TEXT NOT NULL,
  "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "wallet_events_applied_pkey" PRIMARY KEY ("eventId")
);

CREATE TABLE "wallet_pnl_dirty_markets" (
  "onChainMarketId" BIGINT NOT NULL,
  "dirtiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reason" TEXT,

  CONSTRAINT "wallet_pnl_dirty_markets_pkey" PRIMARY KEY ("onChainMarketId")
);
