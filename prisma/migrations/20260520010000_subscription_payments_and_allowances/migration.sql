-- Keep SubscriptionStatus aligned with the current Prisma enum.
ALTER TYPE "SubscriptionStatus" ADD VALUE IF NOT EXISTS 'PENDING_PAYMENT';
ALTER TYPE "SubscriptionStatus" ADD VALUE IF NOT EXISTS 'FAILED';
ALTER TYPE "SubscriptionStatus" ADD VALUE IF NOT EXISTS 'REVOKED';
ALTER TYPE "SubscriptionStatus" ADD VALUE IF NOT EXISTS 'LIMIT_REACHED';

-- Circle nanopayment audit trail for daily passes, per-trace unlocks, refunds, and failed payments.
CREATE TABLE IF NOT EXISTS "payment_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USDC',
    "status" TEXT NOT NULL,
    "traceId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "payment_events_txHash_key" ON "payment_events"("txHash");
CREATE INDEX IF NOT EXISTS "payment_events_userId_idx" ON "payment_events"("userId");
CREATE INDEX IF NOT EXISTS "payment_events_txHash_idx" ON "payment_events"("txHash");

-- Spending approvals for paywall safety limits.
CREATE TABLE IF NOT EXISTS "spending_allowances" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dailyLimit" DOUBLE PRECISION NOT NULL,
    "perTraceLimit" DOUBLE PRECISION NOT NULL,
    "spentToday" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USDC',
    "lastResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "spending_allowances_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "spending_allowances_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "spending_allowances_userId_key" ON "spending_allowances"("userId");
CREATE INDEX IF NOT EXISTS "spending_allowances_userId_idx" ON "spending_allowances"("userId");
