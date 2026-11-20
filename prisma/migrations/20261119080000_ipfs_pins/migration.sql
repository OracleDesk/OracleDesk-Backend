-- Multi-provider IPFS pin replication tracking (#271).
-- Expand-only additive enum and table.
SET lock_timeout = '5s';

CREATE TYPE "IpfsPinState" AS ENUM ('PENDING', 'PINNING', 'PINNED', 'MISSING', 'FAILED');

CREATE TABLE "ipfs_pins" (
    "cid" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "state" "IpfsPinState" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "pinnedAt" TIMESTAMP(3),

    CONSTRAINT "ipfs_pins_pkey" PRIMARY KEY ("cid", "provider")
);
