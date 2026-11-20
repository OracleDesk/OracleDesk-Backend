-- Continuous money audit (#222): runs and findings.
-- Expand-only: two new tables.
SET lock_timeout = '5s';

CREATE TABLE "money_audit_runs" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(3),
    "snapshotAt" TIMESTAMPTZ(3) NOT NULL,
    "observedLedger" INTEGER,
    "checked" INTEGER NOT NULL DEFAULT 0,
    "findings" INTEGER NOT NULL DEFAULT 0,
    "repaired" INTEGER NOT NULL DEFAULT 0,
    "rpcCalls" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "money_audit_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "money_audit_findings" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "invariant" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "suggestedRepair" TEXT,
    "action" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "firstSeenRunId" TEXT NOT NULL,
    "ackedBy" TEXT,
    "ackedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "money_audit_findings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "money_audit_findings_runId_idx" ON "money_audit_findings"("runId");
CREATE INDEX "money_audit_findings_invariant_createdAt_idx" ON "money_audit_findings"("invariant", "createdAt");
CREATE INDEX "money_audit_findings_fingerprint_idx" ON "money_audit_findings"("fingerprint");
