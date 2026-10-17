-- Confidential trace storage and key envelope tables (Issue #154)
-- Forward-only migration. Existing traces remain PLAINTEXT_LEGACY.

CREATE TYPE "TraceContentMode" AS ENUM ('PLAINTEXT_LEGACY', 'ENCRYPTED');

ALTER TABLE "reasoning_traces" ADD COLUMN "contentMode" "TraceContentMode" NOT NULL DEFAULT 'PLAINTEXT_LEGACY';
ALTER TABLE "reasoning_traces" ADD COLUMN "plaintextHash" VARCHAR(64);

CREATE TABLE "trace_keys" (
  "traceId" TEXT NOT NULL,
  "kid" TEXT NOT NULL,
  "wrappedKey" BYTEA NOT NULL,
  "plaintextHash" VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "trace_keys_pkey" PRIMARY KEY ("traceId"),
  CONSTRAINT "trace_keys_traceId_fkey" FOREIGN KEY ("traceId") REFERENCES "reasoning_traces"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
