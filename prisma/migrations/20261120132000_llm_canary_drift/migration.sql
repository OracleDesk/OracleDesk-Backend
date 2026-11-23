-- LLM model drift canary baselines, runs, and time-limited demotions (#296).
CREATE TABLE IF NOT EXISTS "llm_canary_baselines" (
  "id" TEXT NOT NULL,
  "task" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "promptVersion" INTEGER NOT NULL,
  "sampleCount" INTEGER NOT NULL,
  "passCount" INTEGER NOT NULL,
  "passRate" DOUBLE PRECISION NOT NULL,
  "meanScore" DOUBLE PRECISION NOT NULL,
  "scoreStdDev" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "metricsJson" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "llm_canary_baselines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "llm_canary_baselines_task_provider_model_promptVersion_key"
  ON "llm_canary_baselines"("task", "provider", "model", "promptVersion");

CREATE TABLE IF NOT EXISTS "llm_canary_runs" (
  "id" TEXT NOT NULL,
  "task" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "servedModel" TEXT,
  "promptVersion" INTEGER NOT NULL,
  "sampleCount" INTEGER NOT NULL,
  "passCount" INTEGER NOT NULL,
  "passRate" DOUBLE PRECISION NOT NULL,
  "meanScore" DOUBLE PRECISION NOT NULL,
  "pValue" DOUBLE PRECISION,
  "drifted" BOOLEAN NOT NULL DEFAULT false,
  "driftReason" TEXT,
  "budgetSpentUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "details" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "llm_canary_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "llm_canary_runs_task_model_createdAt_idx"
  ON "llm_canary_runs"("task", "model", "createdAt");

CREATE TABLE IF NOT EXISTS "llm_model_demotions" (
  "id" TEXT NOT NULL,
  "task" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "demotedBy" TEXT NOT NULL DEFAULT 'canary',
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "llm_model_demotions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "llm_model_demotions_task_active_expiresAt_idx"
  ON "llm_model_demotions"("task", "active", "expiresAt");
