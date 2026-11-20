SET lock_timeout = '5s';

ALTER TABLE "trades"
  ADD COLUMN "amountRaw" NUMERIC(39,0),
  ADD COLUMN "collateralRaw" NUMERIC(39,0),
  ADD COLUMN "sharesRaw" NUMERIC(39,0),
  ADD COLUMN "feeRaw" NUMERIC(39,0),
  ADD COLUMN "priceBps" INTEGER,
  ADD COLUMN "fillPriceBps" INTEGER,
  ADD COLUMN "edgeBps" INTEGER;

ALTER TABLE "positions"
  ADD COLUMN "entryPriceBps" INTEGER;

ALTER TABLE "position_exits"
  ADD COLUMN "effectivePriceBps" INTEGER;

ALTER TABLE "copy_trades"
  ADD COLUMN "priceBps" INTEGER;

WITH fills AS (
  SELECT
    e."txHash",
    e.params->>'market_id' AS "marketId",
    e.params->'outcome'->>'tag' AS outcome,
    MAX((e.params->>'collateral')::numeric) AS collateral,
    MAX((e.params->>'shares')::numeric) AS shares,
    MAX((e.params->>'fee')::numeric) AS fee
  FROM "chain_events" e
  WHERE e."contractName" = 'marketCore'
    AND e."eventName" = 'Trade'
    AND e.params->>'is_buy' = 'true'
    AND e.params->>'collateral' ~ '^[0-9]+$'
    AND e.params->>'shares' ~ '^[0-9]+$'
    AND e.params->>'fee' ~ '^[0-9]+$'
  GROUP BY e."txHash", e.params->>'market_id', e.params->'outcome'->>'tag'
  HAVING COUNT(*) = 1
)
UPDATE "trades" t
SET "collateralRaw" = f.collateral,
    "sharesRaw" = f.shares,
    "feeRaw" = f.fee,
"fillPriceBps" = CASE WHEN f.shares > 0
      THEN LEAST(10000::numeric, (f.collateral * 10000 + f.shares / 2) / f.shares)::integer
      ELSE NULL
    END,
    "edgeBps" = COALESCE(t."edgeBps", round(t."edgeDetected" * 10000)::integer)
FROM fills f
JOIN "markets" m ON m."onChainMarketId"::text = f."marketId"
WHERE t."txHash" = f."txHash"
  AND t."marketId" = m.id
  AND t.status = 'EXECUTED'
  AND ((t.direction = 'YES' AND f.outcome = 'Yes') OR (t.direction = 'NO' AND f.outcome = 'No'));

UPDATE "trades"
SET "edgeBps" = round("edgeDetected" * 10000)::integer
WHERE "edgeBps" IS NULL;

UPDATE "trades"
SET "priceBps" = round("price" * 10000)::integer
WHERE "priceBps" IS NULL;

UPDATE "positions" p
SET "entryPriceBps" = t."fillPriceBps"
FROM "trades" t
WHERE p."tradeId" = t.id
  AND p."entryPriceBps" IS NULL
  AND t."fillPriceBps" IS NOT NULL;

UPDATE "positions"
SET "entryPriceBps" = round("entryPrice" * 10000)::integer,
    "valuationSource" = COALESCE("valuationSource", 'estimated')
WHERE "entryPriceBps" IS NULL;

UPDATE "position_exits"
SET "effectivePriceBps" = LEAST(
  10000::numeric,
  ("collateralOutRaw" * 10000 + "sharesSoldRaw" / 2) / "sharesSoldRaw"
)::integer
WHERE "sharesSoldRaw" > 0;

UPDATE "positions" p
SET "sharesRaw" = 0,
    "costBasisRaw" = 0,
    "realisedCollateralRaw" = p."realisedCollateralRaw" + settlement.payout,
    "realisedPnlRaw" = p."realisedPnlRaw" + settlement.payout - p."costBasisRaw",
    "unrealisedPnlRaw" = 0,
    "markValueRaw" = 0,
    "liquidationValueRaw" = 0,
    "markPriceBps" = settlement.price_bps,
    "currentPrice" = settlement.price_bps::double precision / 10000,
    "pnl" = (p."realisedPnlRaw" + settlement.payout - p."costBasisRaw")::numeric / 10000000,
    "illiquid" = false
FROM (
  SELECT p.id,
    CASE
      WHEN p."closeReason" = 'VOIDED' THEN p."sharesRaw" / 2
      WHEN (p."closeReason" = 'YES_RESOLVED' AND p.direction = 'YES')
        OR (p."closeReason" = 'NO_RESOLVED' AND p.direction = 'NO') THEN p."sharesRaw"
      ELSE 0
    END AS payout,
    CASE
      WHEN p."closeReason" = 'VOIDED' THEN 5000
      WHEN (p."closeReason" = 'YES_RESOLVED' AND p.direction = 'YES')
        OR (p."closeReason" = 'NO_RESOLVED' AND p.direction = 'NO') THEN 10000
      ELSE 0
    END AS price_bps
  FROM "positions" p
  WHERE p.status = 'CLOSED'
    AND p."closeReason" IN ('YES_RESOLVED', 'NO_RESOLVED', 'VOIDED')
    AND p."sharesRaw" IS NOT NULL
    AND p."costBasisRaw" IS NOT NULL
) settlement
WHERE p.id = settlement.id;

WITH fills AS (
  SELECT
    e."txHash",
    e.params->>'market_id' AS "marketId",
    e.params->'outcome'->>'tag' AS outcome,
    MAX((e.params->>'collateral')::numeric) AS collateral,
    MAX((e.params->>'shares')::numeric) AS shares,
    MAX((e.params->>'fee')::numeric) AS fee
  FROM "chain_events" e
  WHERE e."contractName" = 'marketCore'
    AND e."eventName" = 'Trade'
    AND e.params->>'is_buy' = 'true'
    AND e.params->>'collateral' ~ '^[0-9]+$'
    AND e.params->>'shares' ~ '^[0-9]+$'
    AND e.params->>'fee' ~ '^[0-9]+$'
  GROUP BY e."txHash", e.params->>'market_id', e.params->'outcome'->>'tag'
  HAVING COUNT(*) = 1
)
UPDATE "copy_trades" c
SET "collateralRaw" = COALESCE(c."collateralRaw", f.collateral::text),
    "sharesRaw" = COALESCE(c."sharesRaw", f.shares::text),
    "feeRaw" = COALESCE(c."feeRaw", f.fee::text),
    "priceBps" = CASE WHEN f.shares > 0
      THEN LEAST(10000::numeric, (f.collateral * 10000 + f.shares / 2) / f.shares)::integer
      ELSE NULL
    END
FROM fills f
JOIN "markets" m ON m."onChainMarketId"::text = f."marketId"
WHERE c."txHash" = f."txHash"
  AND c."marketId" = m.id
  AND c.status = 'EXECUTED'
  AND ((c.direction = 'YES' AND f.outcome = 'Yes') OR (c.direction = 'NO' AND f.outcome = 'No'));

ALTER TABLE "trades"
  ADD CONSTRAINT "trades_raw_amounts_nonneg"
    CHECK ("amountRaw" IS NULL OR "amountRaw" >= 0) NOT VALID,
  ADD CONSTRAINT "trades_raw_fill_nonneg"
    CHECK (("collateralRaw" IS NULL OR "collateralRaw" >= 0)
      AND ("sharesRaw" IS NULL OR "sharesRaw" >= 0)
      AND ("feeRaw" IS NULL OR "feeRaw" >= 0)) NOT VALID,
  ADD CONSTRAINT "trades_price_bps_range"
    CHECK ("priceBps" IS NULL OR "priceBps" BETWEEN 0 AND 10000) NOT VALID,
  ADD CONSTRAINT "trades_fill_price_bps_range"
    CHECK ("fillPriceBps" IS NULL OR "fillPriceBps" BETWEEN 0 AND 10000) NOT VALID;

ALTER TABLE "positions"
  ADD CONSTRAINT "positions_entry_price_bps_range"
    CHECK ("entryPriceBps" IS NULL OR "entryPriceBps" BETWEEN 0 AND 10000) NOT VALID;

ALTER TABLE "position_exits"
  ADD CONSTRAINT "position_exits_effective_price_bps_range"
    CHECK ("effectivePriceBps" IS NULL OR "effectivePriceBps" BETWEEN 0 AND 10000) NOT VALID;

ALTER TABLE "copy_trades"
  ADD CONSTRAINT "copy_trades_price_bps_range"
    CHECK ("priceBps" IS NULL OR "priceBps" BETWEEN 0 AND 10000) NOT VALID;

ALTER TABLE "trades" VALIDATE CONSTRAINT "trades_raw_amounts_nonneg";
ALTER TABLE "trades" VALIDATE CONSTRAINT "trades_raw_fill_nonneg";
ALTER TABLE "trades" VALIDATE CONSTRAINT "trades_price_bps_range";
ALTER TABLE "trades" VALIDATE CONSTRAINT "trades_fill_price_bps_range";
ALTER TABLE "positions" VALIDATE CONSTRAINT "positions_entry_price_bps_range";
ALTER TABLE "position_exits" VALIDATE CONSTRAINT "position_exits_effective_price_bps_range";
ALTER TABLE "copy_trades" VALIDATE CONSTRAINT "copy_trades_price_bps_range";
