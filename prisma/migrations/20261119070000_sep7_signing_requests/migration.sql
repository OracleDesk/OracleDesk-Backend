-- SEP-7 single-use treasury multisig signing requests (#270).
-- Expand-only additive table; unique constraints declared inline to avoid
-- non-concurrent CREATE INDEX statements.
SET lock_timeout = '5s';

CREATE TABLE "sep7_requests" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "signer" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "uri" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "rejectCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sep7_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sep7_requests_tokenHash_key" UNIQUE ("tokenHash"),
    CONSTRAINT "sep7_requests_operationId_signer_key" UNIQUE ("operationId", "signer")
);
