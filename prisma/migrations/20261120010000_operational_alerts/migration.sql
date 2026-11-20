-- #226 operational alerts. Expand-only: two new tables, two nullable/defaulted
-- columns on alert_deliveries and reviewId relaxed to nullable. Existing
-- dispute rows all have a reviewId and keep their reviewId:level:sink keys,
-- so nothing is backfilled.
SET lock_timeout = '5s';

CREATE TABLE "alert_incidents" (
  "id" TEXT NOT NULL,
  "subjectType" TEXT NOT NULL,
  "subjectKey" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'PENDING',
  "episode" INTEGER NOT NULL DEFAULT 0,
  "summary" TEXT NOT NULL,
  "detail" JSONB,
  "badStreak" INTEGER NOT NULL DEFAULT 0,
  "goodStreak" INTEGER NOT NULL DEFAULT 0,
  "openedAt" TIMESTAMPTZ(3),
  "resolvedAt" TIMESTAMPTZ(3),
  "ackedAt" TIMESTAMPTZ(3),
  "ackedBy" TEXT,
  "silencedUntil" TIMESTAMPTZ(3),
  "lastNotifiedAt" TIMESTAMPTZ(3),
  "escalations" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "alert_incidents_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "alert_incidents_subjectType_subjectKey_key" ON "alert_incidents"("subjectType", "subjectKey");
CREATE INDEX "alert_incidents_state_severity_idx" ON "alert_incidents"("state", "severity");

CREATE TABLE "cron_runs" (
  "job" TEXT NOT NULL,
  "lastSuccessAt" TIMESTAMPTZ(3),
  "lastFailureAt" TIMESTAMPTZ(3),
  "failureStreak" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "cron_runs_pkey" PRIMARY KEY ("job")
);

ALTER TABLE "alert_deliveries" ALTER COLUMN "reviewId" DROP NOT NULL;
ALTER TABLE "alert_deliveries" ADD COLUMN "incidentId" TEXT;
ALTER TABLE "alert_deliveries" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'open';

-- alerts.manage (ack / silence) for deployments whose RBAC catalogue was
-- seeded before it existed. A fresh database gets it from the boot seed.
INSERT INTO "admin_permissions" ("key", "description")
SELECT 'alerts.manage', 'alerts.manage'
WHERE EXISTS (SELECT 1 FROM "admin_roles")
ON CONFLICT ("key") DO NOTHING;
INSERT INTO "admin_role_permissions" ("roleName", "permissionKey")
SELECT "name", 'alerts.manage' FROM "admin_roles" WHERE "name" IN ('super_admin', 'operator')
ON CONFLICT ("roleName", "permissionKey") DO NOTHING;
