SET lock_timeout = '5s';

CREATE TYPE "AgentDecisionKind" AS ENUM (
  'BUY',
  'SKIP',
  'HEDGE',
  'STOP_LOSS',
  'DRAWDOWN_PAUSE',
  'TREASURY_READ_FAILED',
  'MARKET_SKIP',
  'MARKET_CREATED'
);

CREATE TYPE "AgentDecisionReason" AS ENUM (
  'TREASURY_READ_FAILED',
  'DRAWDOWN_LIMIT',
  'STOP_LOSS_TRIGGERED',
  'HEDGE_EXECUTED',
  'HEDGE_FAILED',
  'POSITION_ALREADY_OPEN',
  'MARKET_NOT_ON_CHAIN',
  'PRICE_STALE',
  'FORECAST_UNAVAILABLE',
  'EDGE_BELOW_MIN',
  'SIZE_ZERO_WIDE_CI',
  'SIZE_BELOW_MIN',
  'BUY_ACCEPTED',
  'BUY_REJECTED',
  'PRICE_SOURCE_DOWN',
  'MARKET_ANALYSIS_FAILED',
  'AGENT_PAUSED',
  'NO_SIGNALS',
  'LLM_BUDGET_EXCEEDED',
  'MARKET_GENERATION_FAILED',
  'PROPOSAL_UNRESOLVABLE',
  'DUPLICATE_PROPOSAL',
  'SEED_POLICY_SKIP',
  'MARKET_CREATED',
  'CYCLE_FAILED'
);

CREATE TABLE "agent_decisions" (
  "id" TEXT NOT NULL,
  "decisionKey" TEXT NOT NULL,
  "cycleId" TEXT NOT NULL,
  "agentType" "AgentType" NOT NULL,
  "kind" "AgentDecisionKind" NOT NULL,
  "reasonCode" "AgentDecisionReason" NOT NULL,
  "marketId" TEXT,
  "traceId" TEXT,
  "tradeId" TEXT,
  "positionId" TEXT,
  "forecastRef" TEXT,
  "inputsDigest" TEXT NOT NULL,
  "inputs" JSONB NOT NULL,
  "sizingRecord" JSONB,
  "outcome" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "agent_decisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "agent_decisions_marketId_fkey"
    FOREIGN KEY ("marketId") REFERENCES "markets"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "agent_decisions_traceId_fkey"
    FOREIGN KEY ("traceId") REFERENCES "reasoning_traces"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "agent_decisions_tradeId_fkey"
    FOREIGN KEY ("tradeId") REFERENCES "trades"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "agent_decisions_positionId_fkey"
    FOREIGN KEY ("positionId") REFERENCES "positions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "agent_decisions_decisionKey_key"
ON "agent_decisions"("decisionKey");
CREATE INDEX "agent_decisions_cycleId_agentType_createdAt_idx"
ON "agent_decisions"("cycleId", "agentType", "createdAt");
CREATE INDEX "agent_decisions_cycleId_marketId_idx"
ON "agent_decisions"("cycleId", "marketId");
CREATE INDEX "agent_decisions_marketId_createdAt_idx"
ON "agent_decisions"("marketId", "createdAt");
CREATE INDEX "agent_decisions_reasonCode_createdAt_idx"
ON "agent_decisions"("reasonCode", "createdAt");
