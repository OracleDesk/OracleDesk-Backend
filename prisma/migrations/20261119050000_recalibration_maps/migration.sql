-- Per-category forecast recalibration (#244).
-- Expand-only: a nullable column on reasoning_traces and a new table.
SET lock_timeout = '5s';

ALTER TABLE "reasoning_traces" ADD COLUMN "rawProbabilityEstimate" DOUBLE PRECISION;
ALTER TABLE "reasoning_traces"
  ADD CONSTRAINT "reasoning_traces_raw_prob_est_range"
  CHECK ("rawProbabilityEstimate" IS NULL OR ("rawProbabilityEstimate" >= 0 AND "rawProbabilityEstimate" <= 1))
  NOT VALID;

CREATE TABLE "recalibration_maps" (
  "id" TEXT NOT NULL,
  "agentType" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "params" JSONB NOT NULL,
  "fittedFrom" JSONB NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "recalibration_maps_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "recalibration_maps_agentType_category_version_key"
  ON "recalibration_maps"("agentType", "category", "version");
CREATE INDEX "recalibration_maps_agentType_category_active_idx"
  ON "recalibration_maps"("agentType", "category", "active");
