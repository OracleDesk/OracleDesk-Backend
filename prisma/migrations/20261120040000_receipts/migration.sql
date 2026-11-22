-- Signed, verifiable purchase receipts (#313).
SET lock_timeout = '5s';

CREATE TABLE "receipts" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "userId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "paymentEventId" TEXT,
    "type" "SubscriptionType" NOT NULL,
    "traceId" TEXT,
    "txHash" TEXT NOT NULL,
    "ledger" INTEGER NOT NULL,
    "payer" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "amountRaw" TEXT NOT NULL,
    "currency" "SettlementCurrency" NOT NULL DEFAULT 'USDC',
    "priceVersion" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "document" JSONB NOT NULL,
    "jws" TEXT NOT NULL,
    "redeemedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "receipts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "receipts_receiptId_key" ON "receipts"("receiptId");
CREATE UNIQUE INDEX "receipts_subscriptionId_key" ON "receipts"("subscriptionId");
CREATE UNIQUE INDEX "receipts_paymentEventId_key" ON "receipts"("paymentEventId");
CREATE INDEX "receipts_userId_createdAt_idx" ON "receipts"("userId", "createdAt");
CREATE INDEX "receipts_txHash_idx" ON "receipts"("txHash");
