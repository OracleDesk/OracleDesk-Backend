-- Expiring admin assignments, two-person privileged grants (#276).
SET lock_timeout = '5s';

ALTER TABLE "admin_role_assignments" ADD COLUMN "expiresAt" TIMESTAMPTZ(3);

UPDATE "admin_role_assignments"
SET "expiresAt" = NOW() + INTERVAL '90 days'
WHERE "expiresAt" IS NULL;

ALTER TABLE "admin_role_assignments" ALTER COLUMN "expiresAt" SET NOT NULL;

CREATE INDEX "admin_role_assignments_expiresAt_idx" ON "admin_role_assignments"("expiresAt");

CREATE TABLE "admin_role_grant_proposals" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "roleName" TEXT NOT NULL,
    "proposedBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMPTZ(3),

    CONSTRAINT "admin_role_grant_proposals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "admin_role_grant_proposals_status_check"
        CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED'))
);

CREATE INDEX "admin_role_grant_proposals_status_expiresAt_idx"
    ON "admin_role_grant_proposals"("status", "expiresAt");
CREATE INDEX "admin_role_grant_proposals_walletAddress_idx"
    ON "admin_role_grant_proposals"("walletAddress");