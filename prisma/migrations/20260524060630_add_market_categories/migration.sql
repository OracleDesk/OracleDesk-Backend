-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MarketCategory" ADD VALUE 'SPORTS';
ALTER TYPE "MarketCategory" ADD VALUE 'ENTERTAINMENT';
ALTER TYPE "MarketCategory" ADD VALUE 'POLITICS';

-- DropIndex
DROP INDEX "signal_cache_expiresAt_idx";

-- DropIndex
DROP INDEX "signal_cache_source_idx";

-- CreateIndex
CREATE INDEX "signal_cache_source_expiresAt_idx" ON "signal_cache"("source", "expiresAt");
