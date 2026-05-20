-- CreateEnum
CREATE TYPE "MarketStatus" AS ENUM ('PENDING', 'ACTIVE', 'RESOLVING', 'RESOLVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MarketCategory" AS ENUM ('FED', 'ECB', 'ELECTION', 'GEOPOLITICAL', 'CRYPTO', 'MACRO');

-- CreateEnum
CREATE TYPE "SettlementCurrency" AS ENUM ('USDC', 'EURC');

-- CreateEnum
CREATE TYPE "TradeDirection" AS ENUM ('YES', 'NO');

-- CreateEnum
CREATE TYPE "TradeStatus" AS ENUM ('PENDING', 'EXECUTED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PositionStatus" AS ENUM ('OPEN', 'CLOSED', 'HEDGED', 'STOP_LOSS');

-- CreateEnum
CREATE TYPE "SubscriptionType" AS ENUM ('PER_TRACE', 'DAILY_PASS');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AgentType" AS ENUM ('MARKET_MAKER', 'TRADER');

-- CreateEnum
CREATE TYPE "LogLevel" AS ENUM ('INFO', 'WARN', 'ERROR', 'DEBUG');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "markets" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "category" "MarketCategory" NOT NULL,
    "status" "MarketStatus" NOT NULL DEFAULT 'PENDING',
    "settlementCurrency" "SettlementCurrency" NOT NULL DEFAULT 'USDC',
    "initialYesProb" DOUBLE PRECISION NOT NULL,
    "currentYesProb" DOUBLE PRECISION,
    "confidenceInterval" JSONB NOT NULL,
    "expiryTimestamp" TIMESTAMP(3) NOT NULL,
    "resolutionOracle" TEXT,
    "minimumLiquidity" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "totalLiquidity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "onChainAddress" TEXT,
    "txHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "markets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trades" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "direction" "TradeDirection" NOT NULL,
    "status" "TradeStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DOUBLE PRECISION NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "edgeDetected" DOUBLE PRECISION NOT NULL,
    "kellyFraction" DOUBLE PRECISION NOT NULL,
    "txHash" TEXT,
    "builderFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "positions" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "direction" "TradeDirection" NOT NULL,
    "status" "PositionStatus" NOT NULL DEFAULT 'OPEN',
    "entryPrice" DOUBLE PRECISION NOT NULL,
    "currentPrice" DOUBLE PRECISION,
    "size" DOUBLE PRECISION NOT NULL,
    "pnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hedgeMarketId" TEXT,
    "closedAt" TIMESTAMP(3),
    "closeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reasoning_traces" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "agentType" "AgentType" NOT NULL,
    "decisionType" TEXT NOT NULL,
    "sourcesUsed" JSONB NOT NULL,
    "probabilityEstimate" DOUBLE PRECISION NOT NULL,
    "marketProbability" DOUBLE PRECISION NOT NULL,
    "edge" DOUBLE PRECISION NOT NULL,
    "confidenceInterval" JSONB NOT NULL,
    "betFraction" DOUBLE PRECISION,
    "betSizeUsdc" DOUBLE PRECISION,
    "hedgeConditions" JSONB,
    "agentWallet" TEXT,
    "signature" TEXT,
    "ipfsCid" TEXT,
    "sha256Hash" TEXT,
    "onChainTxHash" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "previewSources" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reasoning_traces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "copy_trades" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "traceId" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "tradeId" TEXT,
    "direction" "TradeDirection" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "txHash" TEXT,
    "builderFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "TradeStatus" NOT NULL DEFAULT 'PENDING',
    "pnl" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "copy_trades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "traceId" TEXT,
    "type" "SubscriptionType" NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "amountPaid" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USDC',
    "txHash" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_logs" (
    "id" TEXT NOT NULL,
    "agentType" "AgentType" NOT NULL,
    "level" "LogLevel" NOT NULL DEFAULT 'INFO',
    "action" TEXT NOT NULL,
    "marketId" TEXT,
    "data" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signal_cache" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "signal_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "block_index" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "lastBlockNumber" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "block_index_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_walletAddress_key" ON "users"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_walletAddress_idx" ON "users"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "markets_onChainAddress_key" ON "markets"("onChainAddress");

-- CreateIndex
CREATE INDEX "markets_status_idx" ON "markets"("status");

-- CreateIndex
CREATE INDEX "markets_category_idx" ON "markets"("category");

-- CreateIndex
CREATE INDEX "markets_expiryTimestamp_idx" ON "markets"("expiryTimestamp");

-- CreateIndex
CREATE INDEX "markets_settlementCurrency_idx" ON "markets"("settlementCurrency");

-- CreateIndex
CREATE INDEX "trades_marketId_idx" ON "trades"("marketId");

-- CreateIndex
CREATE INDEX "trades_status_idx" ON "trades"("status");

-- CreateIndex
CREATE INDEX "trades_createdAt_idx" ON "trades"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "positions_tradeId_key" ON "positions"("tradeId");

-- CreateIndex
CREATE INDEX "positions_marketId_idx" ON "positions"("marketId");

-- CreateIndex
CREATE INDEX "positions_status_idx" ON "positions"("status");

-- CreateIndex
CREATE INDEX "reasoning_traces_marketId_idx" ON "reasoning_traces"("marketId");

-- CreateIndex
CREATE INDEX "reasoning_traces_ipfsCid_idx" ON "reasoning_traces"("ipfsCid");

-- CreateIndex
CREATE INDEX "reasoning_traces_verified_idx" ON "reasoning_traces"("verified");

-- CreateIndex
CREATE INDEX "reasoning_traces_createdAt_idx" ON "reasoning_traces"("createdAt");

-- CreateIndex
CREATE INDEX "copy_trades_userId_idx" ON "copy_trades"("userId");

-- CreateIndex
CREATE INDEX "copy_trades_traceId_idx" ON "copy_trades"("traceId");

-- CreateIndex
CREATE INDEX "copy_trades_status_idx" ON "copy_trades"("status");

-- CreateIndex
CREATE INDEX "subscriptions_userId_idx" ON "subscriptions"("userId");

-- CreateIndex
CREATE INDEX "subscriptions_status_idx" ON "subscriptions"("status");

-- CreateIndex
CREATE INDEX "subscriptions_expiresAt_idx" ON "subscriptions"("expiresAt");

-- CreateIndex
CREATE INDEX "agent_logs_agentType_idx" ON "agent_logs"("agentType");

-- CreateIndex
CREATE INDEX "agent_logs_level_idx" ON "agent_logs"("level");

-- CreateIndex
CREATE INDEX "agent_logs_createdAt_idx" ON "agent_logs"("createdAt");

-- CreateIndex
CREATE INDEX "signal_cache_source_idx" ON "signal_cache"("source");

-- CreateIndex
CREATE INDEX "signal_cache_expiresAt_idx" ON "signal_cache"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "block_index_chainId_key" ON "block_index"("chainId");

-- AddForeignKey
ALTER TABLE "trades" ADD CONSTRAINT "trades_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "markets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "markets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "trades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reasoning_traces" ADD CONSTRAINT "reasoning_traces_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "markets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copy_trades" ADD CONSTRAINT "copy_trades_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copy_trades" ADD CONSTRAINT "copy_trades_traceId_fkey" FOREIGN KEY ("traceId") REFERENCES "reasoning_traces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copy_trades" ADD CONSTRAINT "copy_trades_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "markets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copy_trades" ADD CONSTRAINT "copy_trades_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "trades"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_traceId_fkey" FOREIGN KEY ("traceId") REFERENCES "reasoning_traces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_logs" ADD CONSTRAINT "agent_logs_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "markets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
