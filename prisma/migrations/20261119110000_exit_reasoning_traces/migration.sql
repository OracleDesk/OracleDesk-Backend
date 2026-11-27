SET lock_timeout = '5s';

ALTER TABLE "positions" ADD COLUMN "entryTraceId" TEXT;

ALTER TABLE "position_exits"
  ADD COLUMN "context" JSONB,
  ADD COLUMN "traceId" TEXT;

CREATE UNIQUE INDEX "position_exits_traceId_key" ON "position_exits"("traceId");

-- Link historical open positions only when one trader trace is unambiguous.
WITH candidates AS (
  SELECT p.id AS position_id, MIN(rt.id) AS trace_id
  FROM "positions" AS p
  JOIN "trades" AS t ON t.id = p."tradeId"
  JOIN "reasoning_traces" AS rt
    ON rt."marketId" = p."marketId"
   AND rt."agentType" = 'TRADER'
   AND rt."createdAt" <= COALESCE(t."executedAt", t."createdAt")
  WHERE p.status = 'OPEN' AND p."entryTraceId" IS NULL
  GROUP BY p.id
  HAVING COUNT(*) = 1
)
UPDATE "positions" AS p
SET "entryTraceId" = candidates.trace_id
FROM candidates
WHERE p.id = candidates.position_id;
