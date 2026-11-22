# Transparency reports v2

OracleDesk publishes a daily report computed **only from chain data** and
`chain_events`, anchors it to a ledger, pins the canonical JSON to IPFS, and
commits its sha256 through the reasoning registry. The public index serves the
CID, hash, on-chain trace id and anchor; `scripts/verify-report.ts` re-checks
them without database access.

## Document (schema v2)

```ts
type AccountingFlag =
  | 'NAV_EXCLUDES_YIELD'
  | 'YIELD_VALUE_IN_SHARES'
  | 'YIELD_READ_FAILED'
  | 'AVAILABLE_MIXES_UNITS';

type ReconciliationFlag = AccountingFlag | 'NAV_DIFF_EXCEEDS_TOLERANCE';

interface TransparencyReportV2 {
  kind: 'oracledesk.transparency-report';
  schemaVersion: 2;
  network: string;                 // Stellar passphrase
  contracts: { treasury; marketCore; usdc; reasoningRegistry };
  agent: string;                   // treasury RiskConfig.agent (signer G-address)
  period: { from: string; to: string };       // UTC day, ISO
  anchor: { ledger: number; closedAt: string };
  consistency: 'exact' | 'best_effort';
  treasury: {
    usdcBalanceRaw: string;        // USDC SAC balance(CONTRACTS.treasury)
    availableCapitalRaw: string;   // treasury.available_capital()
    riskConfig: { maxTradeRaw; maxMarketRaw; maxDailyRaw };
    dailyUsage: { amountRaw: string; dayStart: number };
  };
  chain: {
    navRaw: string;                // treasury.nav()
    liquidRaw: string;             // capital_breakdown().liquid or liquid_capital()
    yieldPrincipalRaw: string;     // capital_breakdown().yield_principal
    yieldValueShares: string | null; // capital_breakdown().yield_value (Blend bTokens)
    queueReservedRaw: string;      // treasury.queue_reserved()
    netExposureRaw: string;        // treasury.net_exposure()
    ledger: number;
  };
  reconciliation: {
    navDiffRaw: string;            // chain.navRaw - (usdcBalanceRaw + Σ recomputedFloorRaw - queueReservedRaw)
    perMarket: Array<{
      marketId: string;
      chainFloorRaw: string;       // treasury.market_valuation(marketId)
      recomputedFloorRaw: string;  // independently recomputed floor
      diffRaw: string;             // chainFloorRaw - recomputedFloorRaw
    }>;
    flags: ReconciliationFlag[];
  };
  markets: Array<{
    marketId: string;
    status: 'Open' | 'Resolved:Yes' | 'Resolved:No' | 'Void';
    createdByTreasury: boolean;    // matched against CONTRACTS.treasury
    position: { yesRaw: string; noRaw: string };
    reserves: { yesRaw: string; noRaw: string };
    priceYesBps: number;
    markValueRaw: string;
    liquidationValueRaw: string;
    settlementValueRaw: string | null;
    lpRemainderRaw?: string;       // final, unclaimed treasury-created pools
    archived?: boolean;
  }>;
  totals: { positionsMarkRaw; positionsLiquidationRaw; navRaw };
  period_flows: {
    coverage: { fromLedger; toLedger; complete; gaps: Array<[number, number]> };
    tradesBoughtRaw; tradesSoldRaw; feesPaidRaw; redeemedRaw;
    feesCollectedRaw; seedDeployedRaw; tradeCount;
  };
  traces: { total: number; byAction: Record<string, number> };
  method: { version: '2'; doc: string };
  previous: { onChainTraceId: string; traceHash: string } | null;
}
```

All amounts are integer strings in 7-decimal USDC base units (except `chain.yieldValueShares`, which is denominated in Blend pool shares / bTokens). No Prisma float model is imported by the report service (CI asserts the import boundary). The JSON schema is served at `GET /api/v1/schemas/report/v2.json`.

## Identity semantics (#299)

- **Treasury contract (`CONTRACTS.treasury`)** is the on-chain market creator/LP and the `trader`/`holder`/`creator` in `agent_create_market`, `agent_buy`, `agent_sell`, and `redeem`. All holdings, `createdByTreasury`, `usdcBalanceRaw` (via SAC `balance(CONTRACTS.treasury)`), and `period_flows` match `CONTRACTS.treasury`.
- **Agent signer (`RiskConfig.agent`)** is the signing G-address recorded in `report.agent` and matched against `reasoning_registry` trace `agent` fields.

## Known contract gaps & reconciliation flags (#299)

The backend publishes the treasury contract's authoritative views in `chain` alongside independently recomputed figures in `reconciliation` and flags known gaps without hiding any difference:

| Flag | Meaning |
|---|---|
| `NAV_EXCLUDES_YIELD` | A yield venue is configured and enabled; on-chain `compute_nav` does not add yield-venue capital. |
| `YIELD_VALUE_IN_SHARES` | `capital_breakdown().yield_value` returns Blend pool shares (`supply_shares` / bTokens), not USDC collateral. |
| `YIELD_READ_FAILED` | `capital_breakdown()` trapped (e.g., `BlendPositions` decoding mismatch); the reader fell back to `liquid_capital()` and set `yieldValueShares: null`. |
| `AVAILABLE_MIXES_UNITS` | `available_capital()` adds share-denominated yield to liquid USDC, mixing units; trade sizing ignores it in favour of `max(0, liquid - queueReserved)`. |
| `NAV_DIFF_EXCEEDS_TOLERANCE` | `|reconciliation.navDiffRaw| > REPORT_NAV_TOLERANCE_RAW`. The report is still published with `consistency: 'best_effort'` so discrepancies remain visible. |

## Integers and valuations

`BPS = 10_000`. Let `p = priceYesBps(reserve_yes, reserve_no)` from
`src/generated/fpmm.ts`.

- `markValueRaw = floor((yes × p + no × (BPS − p)) / BPS)`
- `liquidationValueRaw = collateralOutForShares(reserve_yes, reserve_no, yes, fee_bps)
  + collateralOutForShares(reserve_no, reserve_yes, no, fee_bps)`
- `settlementValueRaw = settleValue(kind, yes, no)` for final markets, where
  `kind` is `yes`, `no` or `void`.
- `lpRemainderRaw = settleValue(kind, reserve_yes, reserve_no)` for final,
  unclaimed (`lp_claimed === false`) pools created by the treasury.
- `recomputedFloorRaw`: for open markets `min(yes, no)` (+ `min(reserve_yes, reserve_no)` for unclaimed treasury-created pools); for final markets `settleValue(kind, yes, no)` (+ `lpRemainderRaw`).
- `totals.positionsMarkRaw = Σ markValueRaw`;
  `positionsLiquidationRaw = Σ liquidationValueRaw`;
  `navRaw = usdcBalanceRaw + positionsMarkRaw`.
- `reconciliation.navDiffRaw = chain.navRaw − (usdcBalanceRaw + Σ recomputedFloorRaw − chain.queueReservedRaw)`.

## Snapshot

Simulations run against the RPC's latest state; Soroban cannot pin a
historical ledger. The builder therefore:

1. reads `getLatestLedger()` → `L0`;
2. reads the treasury's open-market index (`open_markets()` / `OpenMarkets` storage) to avoid an O(market_count) scan (falling back to `0..marketCount()` only if the index is unavailable) and reads each market, treasury position, and `market_valuation(id)`;
3. reads `getLatestLedger()` → `L1`;
4. if `L1 > L0` or treasury instance `lastModifiedLedgerSeq > L0`, retries up to 3 times; after the third attempt the report is still published with `consistency: 'best_effort'` and `anchor.ledger = L1`.

## Period flows

Events are `chain_events` rows whose `ledgerClosedAt` falls in the UTC day:

- market-core `Trade` with `trader = CONTRACTS.treasury`: buys/sells (`is_buy`),
  `fee`, and `tradeCount`;
- market-core `Redeemed` with `holder = CONTRACTS.treasury`;
- treasury `FeesCollected`;
- market-core `MarketCreated` with `creator = CONTRACTS.treasury` (`seed_amount`).

`coverage.complete` is false when the stored indexer cursor is older than the
last ledger in the period; the missing range is listed in `coverage.gaps`.

## Trace counts

The report walks `traceCount()`/`get_trace(i)` and caches immutable trace
metadata in `registry_trace_cache`. Only traces whose `agent` equals the
treasury's `RiskConfig.agent` are counted in `traces.total` and
`traces.byAction`.

## Sentinel market id

`publish_trace` requires a `market_id`. Reports use
`REPORT_MARKET_ID = 18446744073709551615` (`u64::MAX`) and action `"report"`.

## Publishing and idempotency

`REPORTS_ENABLED=true` schedules `REPORT_CRON` (default `10 0 * * *`,
`Etc/UTC`). The job:

1. builds the document for the UTC day;
2. canonicalises and pins it (`pinJson`);
3. publishes `trace_hash`/`ipfs_cid` via `publish_trace` (respecting
   `CHAIN_EXECUTION_MODE`; `REPORT_MODE=dry-run` is also supported);
4. inserts or updates `transparency_reports`.

If a row exists without `onChainTraceId`, the job re-publishes the **stored bytes** — it never recomputes.

## Verification

```bash
npm run verify:report -- --date 2026-10-14 [--rpc URL] [--gateway URL]
npm run verify:report -- --trace-id 42
```

The verifier uses only `@stellar/stellar-sdk` and the generated bindings:

1. walks `market_trace_count(u64::MAX)` / `market_trace_at` (or uses `--trace-id`);
2. fetches the CID from the gateway, computes sha256 and compares it with the on-chain `trace_hash`;
3. checks the trace agent equals the report agent and the treasury `RiskConfig.agent`;
4. recomputes `totals.positionsMarkRaw` and `totals.navRaw`;
5. for schema v2 reports, validates the `chain` and `reconciliation` blocks and recomputes `perMarket[*].diffRaw` and `reconciliation.navDiffRaw`;
6. follows `previous` and checks the previous trace hash/action;
7. reports whether the state moved since the anchor ledger.

It exits non-zero on any failed check.
