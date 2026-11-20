-- CreateTable
CREATE TABLE "market_reservations" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "questionKey" TEXT NOT NULL,
    "category" "MarketCategory" NOT NULL,
    "expiryTimestamp" TIMESTAMPTZ(3) NOT NULL,
    "embeddingModel" TEXT,
    "embeddingVector" JSONB,
    "status" TEXT NOT NULL,
    "marketId" TEXT,
    "leaseUntil" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "market_reservations_marketId_key" ON "market_reservations"("marketId");

-- CreateIndex
CREATE INDEX "market_reservations_status_leaseUntil_idx" ON "market_reservations"("status", "leaseUntil");

-- Partial unique index: at most one HELD reservation per exact question key.
-- COMMITTED and RELEASED rows are excluded so the same key can be re-reserved
-- after a release or crash.
CREATE UNIQUE INDEX "market_reservations_questionKey_held_idx"
    ON "market_reservations" ("questionKey")
    WHERE "status" = 'HELD';
