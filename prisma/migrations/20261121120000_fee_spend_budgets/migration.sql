CREATE TABLE "fee_spend_entries" (
  "id" TEXT NOT NULL,
  "reservationId" TEXT NOT NULL,
  "opClass" TEXT NOT NULL,
  "windowSeconds" INTEGER NOT NULL,
  "windowStart" TIMESTAMPTZ(3) NOT NULL,
  "windowEnd" TIMESTAMPTZ(3) NOT NULL,
  "amount" BIGINT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RESERVED',
  "settledAmount" BIGINT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "settledAt" TIMESTAMPTZ(3),
  CONSTRAINT "fee_spend_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fee_spend_entries_reservationId_windowSeconds_key" ON "fee_spend_entries"("reservationId", "windowSeconds");
CREATE INDEX "fee_spend_entries_opClass_windowStart_windowEnd_status_idx" ON "fee_spend_entries"("opClass", "windowStart", "windowEnd", "status");
CREATE INDEX "fee_spend_entries_reservationId_status_idx" ON "fee_spend_entries"("reservationId", "status");
