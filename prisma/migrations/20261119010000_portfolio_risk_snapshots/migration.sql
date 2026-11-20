-- Migration: portfolio_risk_snapshots (#280)

CREATE TABLE portfolio_risk_snapshots (
  id                      TEXT        NOT NULL PRIMARY KEY,
  "computedAt"            TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "correlationSnapshotId" TEXT,
  "inputsHash"            TEXT        NOT NULL,
  paths                   INTEGER     NOT NULL,
  metrics                 JSONB       NOT NULL,
  flags                   JSONB       NOT NULL,
  "durationMs"            INTEGER     NOT NULL
);

CREATE INDEX idx_portfolio_risk_snapshots_computed_at
  ON portfolio_risk_snapshots ("computedAt");
