-- Premium session device registry and daily usage budgets (#288).
-- Expand-only: two new tables. The foreign keys are declared inline because
-- the tables are new and empty, so no existing rows need validating.
SET lock_timeout = '5s';

CREATE TABLE "premium_devices" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceKeyHash" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'Device',
    "firstSid" TEXT NOT NULL,
    "lastSid" TEXT NOT NULL,
    "ipPrefixHash" TEXT,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(3),
    "revokeReason" TEXT,

    CONSTRAINT "premium_devices_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "premium_devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "premium_devices_userId_deviceKeyHash_key" ON "premium_devices"("userId", "deviceKeyHash");
CREATE INDEX "premium_devices_userId_lastSeenAt_idx" ON "premium_devices"("userId", "lastSeenAt");

CREATE TABLE "premium_usage_daily" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "premiumReads" INTEGER NOT NULL DEFAULT 0,
    "keyReleases" INTEGER NOT NULL DEFAULT 0,
    "devicesEvicted" INTEGER NOT NULL DEFAULT 0,
    "distinctIpPrefixes" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "premium_usage_daily_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "premium_usage_daily_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "premium_usage_daily_userId_day_key" ON "premium_usage_daily"("userId", "day");
CREATE INDEX "premium_usage_daily_distinctIpPrefixes_idx" ON "premium_usage_daily"("distinctIpPrefixes");
