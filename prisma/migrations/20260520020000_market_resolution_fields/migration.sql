ALTER TABLE "markets" ADD COLUMN IF NOT EXISTS "resolvedOutcome" BOOLEAN;
ALTER TABLE "markets" ADD COLUMN IF NOT EXISTS "resolvedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "markets_resolvedAt_idx" ON "markets"("resolvedAt");
