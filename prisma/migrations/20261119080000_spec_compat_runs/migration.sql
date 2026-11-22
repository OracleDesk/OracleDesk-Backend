-- Runtime contract spec-compat monitor history and agent control holds (#322).
SET lock_timeout = '5s';

CREATE TABLE "spec_compat_runs" (
  "id" TEXT NOT NULL,
  "checkedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "trigger" TEXT NOT NULL,
  "cls" TEXT NOT NULL,
  "ok" BOOLEAN NOT NULL,
  "report" JSONB NOT NULL,
  "affected" TEXT[] DEFAULT ARRAY[]::TEXT[],

  CONSTRAINT "spec_compat_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_control_holds" (
  "scope" "AgentControlScope" NOT NULL,
  "source" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ackRequired" BOOLEAN NOT NULL DEFAULT false,
  "ackedBy" TEXT,

  CONSTRAINT "agent_control_holds_pkey" PRIMARY KEY ("scope", "source")
);

CREATE INDEX "spec_compat_runs_checkedAt_idx" ON "spec_compat_runs"("checkedAt" DESC);
