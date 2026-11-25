-- Versioned trader / market-maker risk parameters (#274).
SET lock_timeout = '5s';

CREATE TABLE "risk_param_sets" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "params" JSONB NOT NULL,
    "paramsHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "reason" TEXT NOT NULL,
    "proposedBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "activatedBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMPTZ(3),
    "activatedAt" TIMESTAMPTZ(3),

    CONSTRAINT "risk_param_sets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "risk_param_sets_scope_version_key" UNIQUE ("scope", "version"),
    CONSTRAINT "risk_param_sets_scope_check" CHECK ("scope" IN ('TRADER', 'MARKET_MAKER')),
    CONSTRAINT "risk_param_sets_status_check" CHECK (
        "status" IN ('PROPOSED', 'APPROVED', 'ACTIVE', 'RETIRED', 'REJECTED')
    )
);

CREATE UNIQUE INDEX "risk_param_sets_one_active_per_scope"
    ON "risk_param_sets" ("scope")
    WHERE "status" = 'ACTIVE';

CREATE TABLE "risk_param_active" (
    "scope" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "activatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "risk_param_active_pkey" PRIMARY KEY ("scope"),
    CONSTRAINT "risk_param_active_scope_check" CHECK ("scope" IN ('TRADER', 'MARKET_MAKER'))
);

CREATE INDEX "risk_param_sets_scope_status_idx" ON "risk_param_sets" ("scope", "status");

INSERT INTO "admin_permissions" ("key", "description")
VALUES
  ('risk_params.propose', 'risk_params.propose'),
  ('risk_params.approve', 'risk_params.approve')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "admin_role_permissions" ("roleName", "permissionKey")
SELECT r."name", p.key
FROM "admin_roles" r
CROSS JOIN (VALUES ('risk_params.propose'), ('risk_params.approve')) AS p(key)
WHERE r."name" = 'super_admin' OR (r."name" = 'operator' AND p.key = 'risk_params.propose')
ON CONFLICT ("roleName", "permissionKey") DO NOTHING;

ALTER TYPE "AgentDecisionReason" ADD VALUE IF NOT EXISTS 'CONSERVATIVE_EDGE_BELOW_MIN';