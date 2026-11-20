-- #220 chain-write readiness: the outbox probe runs one grouped query over
-- chain_transactions WHERE "handledAt" IS NULL (every in-flight row plus
-- terminal rows whose completion handler has not run). This partial index
-- covers that query (status for the GROUP BY, updatedAt for the ages, maxTime
-- for the past-timebounds count) so /readyz never scans handled history.
--
-- Not representable in schema.prisma (partial + INCLUDE); see
-- prisma/drift-allowlist.json. Built without CONCURRENTLY because Prisma runs
-- each migration in a transaction; see prisma/migration-allowlist.json.
SET lock_timeout = '5s';

CREATE INDEX "chain_transactions_unhandled_idx"
  ON "chain_transactions" ("status", "updatedAt") INCLUDE ("maxTime")
  WHERE "handledAt" IS NULL;
