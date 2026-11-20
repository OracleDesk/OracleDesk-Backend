-- Detached Ed25519 trace signing key support (#273).
-- Expand-only: additive enum values and nullable CHAR(64) column.
SET lock_timeout = '5s';

ALTER TYPE "TraceAuditStatus" ADD VALUE IF NOT EXISTS 'SIGNATURE_INVALID';
ALTER TYPE "TraceAuditStatus" ADD VALUE IF NOT EXISTS 'UNSIGNED';

ALTER TABLE "reasoning_traces"
  ADD COLUMN "signingKey" CHAR(64);
