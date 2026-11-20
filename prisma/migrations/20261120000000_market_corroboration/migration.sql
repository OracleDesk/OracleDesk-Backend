-- #228 cross-source corroboration verdict on the market row:
-- { kind, corroborators: [{ signalId, clusterId, domain, source, publishedAt }], policy, checkedAt }.
-- Nullable, no default: markets created before the gate have none.
SET lock_timeout = '5s';

ALTER TABLE "markets" ADD COLUMN "corroboration" JSONB;
