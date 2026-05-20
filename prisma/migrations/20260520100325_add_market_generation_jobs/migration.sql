-- CreateTable
CREATE TABLE "market_generation_jobs" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "marketId" TEXT,
    "traceId" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "market_generation_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "market_generation_jobs_marketId_key" ON "market_generation_jobs"("marketId");

-- CreateIndex
CREATE INDEX "market_generation_jobs_status_idx" ON "market_generation_jobs"("status");

-- AddForeignKey
ALTER TABLE "market_generation_jobs" ADD CONSTRAINT "market_generation_jobs_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "markets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
