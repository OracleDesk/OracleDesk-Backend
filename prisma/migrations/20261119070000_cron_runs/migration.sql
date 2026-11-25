-- Persist cron run history and schedule registrations across instances (#336).
SET lock_timeout = '5s';

CREATE TABLE "cron_runs" (
  "id" TEXT NOT NULL,
  "job" TEXT NOT NULL,
  "instanceId" TEXT NOT NULL,
  "cycleId" TEXT NOT NULL,
  "scheduledAt" TIMESTAMPTZ(3) NOT NULL,
  "startedAt" TIMESTAMPTZ(3) NOT NULL,
  "finishedAt" TIMESTAMPTZ(3),
  "outcome" TEXT NOT NULL DEFAULT 'RUNNING',
  "errorClass" TEXT,
  "errorMessage" TEXT,
  "durationMs" INTEGER,
  "counters" JSONB,

  CONSTRAINT "cron_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cron_registrations" (
  "instanceId" TEXT NOT NULL,
  "job" TEXT NOT NULL,
  "expression" TEXT NOT NULL,
  "timezone" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL,
  "heartbeatAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "cron_registrations_pkey" PRIMARY KEY ("instanceId", "job")
);

CREATE INDEX "cron_runs_job_startedAt_idx" ON "cron_runs"("job", "startedAt" DESC);
CREATE INDEX "cron_runs_outcome_startedAt_idx" ON "cron_runs"("outcome", "startedAt");
