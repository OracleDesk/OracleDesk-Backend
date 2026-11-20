-- Learned signal source weights (#223).
-- Expand-only: a new table, a nullable column on reasoning_traces and the
-- agents.weights.approve permission for super_admin on databases whose RBAC
-- catalogue was seeded before this permission existed.
SET lock_timeout = '5s';

CREATE TABLE "source_weight_sets" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "weights" JSONB NOT NULL,
    "intervals" JSONB NOT NULL,
    "method" JSONB NOT NULL,
    "parentId" TEXT,
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "activatedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_weight_sets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "source_weight_sets_version_key" UNIQUE ("version"),
    CONSTRAINT "source_weight_sets_status_check" CHECK ("status" IN ('DRAFT', 'APPROVED', 'ACTIVE', 'RETIRED'))
);

-- At most one ACTIVE set: concurrent activations cannot both commit.
CREATE UNIQUE INDEX "source_weight_sets_active_key"
    ON "source_weight_sets" ((true))
    WHERE "status" = 'ACTIVE';

ALTER TABLE "reasoning_traces" ADD COLUMN "sourceWeightSetVersion" INTEGER;

-- DATA: grant the new permission where the catalogue already exists. A fresh
-- database gets it from ensureAdminRbacSeeded (skipDuplicates).
INSERT INTO "admin_permissions" ("key", "description")
VALUES ('agents.weights.approve', 'agents.weights.approve')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "admin_role_permissions" ("roleName", "permissionKey")
SELECT r."name", 'agents.weights.approve'
FROM "admin_roles" r
WHERE r."name" = 'super_admin'
ON CONFLICT ("roleName", "permissionKey") DO NOTHING;
