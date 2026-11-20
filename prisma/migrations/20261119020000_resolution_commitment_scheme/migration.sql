-- Expand-only: add new nullable/defaulted columns; existing rows keep 'legacy'.

-- resolution_scheme: which hash formula was used for this market's resolutionHash.
ALTER TABLE "markets"
  ADD COLUMN "resolution_scheme" text NOT NULL DEFAULT 'legacy';

ALTER TABLE "markets"
  ADD CONSTRAINT "markets_resolution_scheme_values"
  CHECK ("resolution_scheme" IN ('legacy', 'v2', 'scaled', 'twap'));

-- resolution_salt: 64 hex chars (32 bytes), only for scheme = 'v2'.
ALTER TABLE "markets"
  ADD COLUMN "resolution_salt" text;

-- resolution_network_id: sha256(STELLAR_NETWORK_PASSPHRASE) hex, only for scheme = 'v2'.
ALTER TABLE "markets"
  ADD COLUMN "resolution_network_id" text;

-- resolution_market_core: contract address, only for scheme = 'v2'.
ALTER TABLE "markets"
  ADD COLUMN "resolution_market_core" text;

-- Require salt, network_id and market_core together when scheme is 'v2'.
ALTER TABLE "markets"
  ADD CONSTRAINT "markets_v2_fields_required"
  CHECK (
    "resolution_scheme" != 'v2'
    OR ("resolution_salt" IS NOT NULL AND "resolution_network_id" IS NOT NULL AND "resolution_market_core" IS NOT NULL)
  );
