-- Migration: 20261020020000_trace_verdicts (#306)
-- Adds TraceVerdictKind enum, verdict columns on reasoning_traces,
-- trace_flag_events history table, and agent_revocations table.
SET lock_timeout = '5s';

CREATE TYPE "TraceVerdictKind" AS ENUM (
    'VALID',
    'HASH_MISMATCH',
    'FLAGGED',
    'AGENT_REVOKED_AFTER',
    'UNKNOWN'
);

ALTER TABLE "reasoning_traces"
    ADD COLUMN IF NOT EXISTS "verdict" "TraceVerdictKind" NOT NULL DEFAULT 'UNKNOWN',
    ADD COLUMN IF NOT EXISTS "verdict_reason" TEXT,
    ADD COLUMN IF NOT EXISTS "verdict_effective_from" BIGINT,
    ADD COLUMN IF NOT EXISTS "verdict_checked_at" TIMESTAMPTZ(3),
    ADD COLUMN IF NOT EXISTS "verdict_version" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "reasoning_traces_verdict_verdict_checked_at_idx" ON "reasoning_traces"("verdict", "verdict_checked_at");
CREATE INDEX IF NOT EXISTS "reasoning_traces_agentWallet_idx" ON "reasoning_traces"("agentWallet");

CREATE TABLE IF NOT EXISTS "trace_flag_events" (
    "id" TEXT NOT NULL,
    "on_chain_trace_id" BIGINT NOT NULL,
    "active" BOOLEAN NOT NULL,
    "reason" TEXT NOT NULL,
    "flagged_at" BIGINT NOT NULL,
    "history_index" INTEGER NOT NULL,
    "observed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trace_flag_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "trace_flag_events_on_chain_trace_id_history_index_key" ON "trace_flag_events"("on_chain_trace_id", "history_index");
CREATE INDEX IF NOT EXISTS "trace_flag_events_on_chain_trace_id_idx" ON "trace_flag_events"("on_chain_trace_id");

CREATE TABLE IF NOT EXISTS "agent_revocations" (
    "agent" TEXT NOT NULL,
    "effective_from" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "observed_ledger" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_revocations_pkey" PRIMARY KEY ("agent")
);
