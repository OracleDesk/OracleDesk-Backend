-- Cross-channel payment transfer event claim ledger (#312).
-- Prevents one USDC transfer from being claimed by both an x402 purchase and a daily pass.
SET lock_timeout = '5s';

CREATE TYPE "PaymentClaimChannel" AS ENUM (
    'LEGACY_UNLOCK',
    'PAYMENT_INTENT',
    'X402_SETTLEMENT',
    'REFUND',
    'BACKFILL'
);

CREATE TABLE "payment_claims" (
    "id" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "opIndex" INTEGER NOT NULL DEFAULT 0,
    "eventIndex" INTEGER NOT NULL DEFAULT 0,
    "channel" "PaymentClaimChannel" NOT NULL,
    "userId" TEXT,
    "amountRaw" TEXT NOT NULL,
    "paymentEventId" TEXT,
    "x402SettlementTxHash" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_claims_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_claims_txHash_opIndex_eventIndex_key"
    ON "payment_claims"("txHash", "opIndex", "eventIndex");
CREATE INDEX "payment_claims_txHash_idx" ON "payment_claims"("txHash");
CREATE INDEX "payment_claims_userId_idx" ON "payment_claims"("userId");

-- Backfill historic confirmed payment events so old claims block cross-channel reuse.
INSERT INTO "payment_claims" (
    "id",
    "txHash",
    "opIndex",
    "eventIndex",
    "channel",
    "userId",
    "amountRaw",
    "paymentEventId",
    "createdAt"
)
SELECT
    'backfill-pe-' || pe."id",
    LOWER(pe."txHash"),
    0,
    0,
    'BACKFILL'::"PaymentClaimChannel",
    pe."userId",
    COALESCE(pe."amountRaw", '0'),
    pe."id",
    pe."createdAt"
FROM "payment_events" pe
WHERE pe."status" = 'CONFIRMED'
ON CONFLICT ("txHash", "opIndex", "eventIndex") DO NOTHING;

-- Backfill historic x402 settlements.
INSERT INTO "payment_claims" (
    "id",
    "txHash",
    "opIndex",
    "eventIndex",
    "channel",
    "userId",
    "amountRaw",
    "x402SettlementTxHash",
    "createdAt"
)
SELECT
    'backfill-x402-' || LOWER(xs."txHash"),
    LOWER(xs."txHash"),
    0,
    0,
    'BACKFILL'::"PaymentClaimChannel",
    xs."userId",
    xs."amountRaw",
    xs."txHash",
    xs."createdAt"
FROM "x402_settlements" xs
ON CONFLICT ("txHash", "opIndex", "eventIndex") DO NOTHING;
