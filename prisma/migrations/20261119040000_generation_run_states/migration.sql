-- Market generation saga: new step states (#242).
-- DDL only. Postgres allows ALTER TYPE ... ADD VALUE inside a transaction,
-- but a new value cannot be used in the same transaction, so nothing here
-- writes rows with them. TRACE_PINNED / TRACE_PUBLISHED stay for legacy rows
-- and are mapped to TRACE_ENQUEUED by the saga on resume.
SET lock_timeout = '5s';
ALTER TYPE "GenerationRunState" ADD VALUE IF NOT EXISTS 'GATED';
ALTER TYPE "GenerationRunState" ADD VALUE IF NOT EXISTS 'VALIDATED';
ALTER TYPE "GenerationRunState" ADD VALUE IF NOT EXISTS 'SEED_PLANNED';
ALTER TYPE "GenerationRunState" ADD VALUE IF NOT EXISTS 'TRACE_ENQUEUED';
