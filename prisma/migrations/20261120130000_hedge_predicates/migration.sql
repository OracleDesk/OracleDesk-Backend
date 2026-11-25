-- Machine-checkable hedge predicates (#302).
-- Links trades and positions to their justifying reasoning trace, stores
-- validated predicates on traces and per position, and adds decision enum values.
SET lock_timeout = '5s';

ALTER TYPE "AgentDecisionKind" ADD VALUE IF NOT EXISTS 'HEDGE_PREDICATE';
ALTER TYPE "AgentDecisionReason" ADD VALUE IF NOT EXISTS 'HEDGE_PREDICATE_EXIT';
ALTER TYPE "AgentDecisionReason" ADD VALUE IF NOT EXISTS 'HEDGE_PREDICATE_REFORECAST';

ALTER TABLE "reasoning_traces"
    ADD COLUMN IF NOT EXISTS "hedgePredicates" JSONB;

ALTER TABLE "trades"
    ADD COLUMN IF NOT EXISTS "traceId" TEXT;

ALTER TABLE "positions"
    ADD COLUMN IF NOT EXISTS "traceId" TEXT;

ALTER TABLE "trades"
    ADD CONSTRAINT "trades_traceId_fkey"
    FOREIGN KEY ("traceId") REFERENCES "reasoning_traces"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

ALTER TABLE "trades"
    VALIDATE CONSTRAINT "trades_traceId_fkey";

ALTER TABLE "positions"
    ADD CONSTRAINT "positions_traceId_fkey"
    FOREIGN KEY ("traceId") REFERENCES "reasoning_traces"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

ALTER TABLE "positions"
    VALIDATE CONSTRAINT "positions_traceId_fkey";

CREATE TABLE "position_predicates" (
    "id" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "traceId" TEXT,
    "predicateId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "predicate" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "evaluatedAt" TIMESTAMPTZ(3),
    "triggeredAt" TIMESTAMPTZ(3),
    "triggerCycleId" TEXT,
    "evaluationResult" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "position_predicates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "position_predicates_status_values"
        CHECK ("status" IN ('ACTIVE', 'TRIGGERED', 'CANCELLED')),
    CONSTRAINT "position_predicates_action_values"
        CHECK ("action" IN ('EXIT', 'REFORECAST'))
);

CREATE UNIQUE INDEX "position_predicates_positionId_predicateId_key"
    ON "position_predicates"("positionId", "predicateId");

CREATE INDEX "position_predicates_status_idx"
    ON "position_predicates"("status");

ALTER TABLE "position_predicates"
    ADD CONSTRAINT "position_predicates_positionId_fkey"
    FOREIGN KEY ("positionId") REFERENCES "positions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
