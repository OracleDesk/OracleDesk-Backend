# Pinned Document and Trace Format Specification

OracleDesk pins verifiable artefacts to IPFS:
1. **Question Documents**: committed on-chain through `market_core.agent_create_market(question_hash, meta_uri, ...)`
2. **Reasoning Traces**: committed on-chain through `reasoning_registry.publish_trace(trace_hash, ipfs_cid, ...)`

---

## 1. Versioning Policy

Every pinned document includes explicit metadata:
- `schemaVersion`: an integer version number (e.g. `2` for TraceDocV2, `2` for QuestionDocV2).
- `kind`: document discriminator (e.g. `'oracledesk.trace'`, `'oracledesk.question'`, `'oracledesk.trace.enc'`).

Any semantic change, added required field, or removed field bumps `schemaVersion`.
Legacy unversioned documents are permanently identified as `schemaVersion: 0` in API responses and continue to verify by their exact sha256 byte hash.

---

## 2. Canonical JSON Serialization

To ensure consistent cryptographic hashing across different runtimes and languages, OracleDesk follows strict JSON canonicalization:
1. Object keys are sorted lexicographically (UTF-8 code units) at every level.
2. No unnecessary whitespace is added (`separators=(',', ':')`).
3. Floating point numbers use standard shortest round-trip formatting.
4. Optional fields are explicitly set to `null` rather than omitted, preserving identical key sets across all code paths.
5. Strict checks reject `undefined`, functions, symbols, `Date` objects, and non-finite numbers (`NaN`, `Infinity`).

> [!IMPORTANT]
> Verifiers must check hashes against the **raw fetched bytes** from IPFS, rather than parsing and re-serializing the JSON. Re-serializing in other languages or engines can cause float or unicode differences.

---

## 3. Reasoning Trace Document (v1)

JSON Schema URL: `https://api.oracledesk.io/api/v1/schemas/trace/v1.json`

```json
{
  "schemaVersion": 1,
  "kind": "oracledesk.trace",
  "traceId": "11111111-1111-1111-1111-111111111111",
  "agentType": "MARKET_MAKER",
  "decisionType": "MARKET_CREATION",
  "action": "create_market",
  "market": {
    "backendId": "22222222-2222-2222-2222-222222222222",
    "onChainId": "0"
  },
  "probabilityEstimate": 0.65,
  "marketProbability": 0.5,
  "edge": 0.15,
  "confidenceInterval": {
    "lower": 0.55,
    "upper": 0.75
  },
  "sourcesUsed": [
    {
      "source": "FRED",
      "weight": 0.8,
      "signal": "Federal funds futures imply 25bps cut",
      "rawValue": 0.75
    }
  ],
  "betFraction": null,
  "betSizeUsdc": null,
  "hedgeConditions": [
    "CPI YoY exceeds 3.0%"
  ],
  "agentWallet": null,
  "createdAt": "2026-10-17T00:00:00.000Z"
}
```

---

## 3b. Reasoning Trace Document (v2)

JSON Schema URL: `https://api.oracledesk.io/api/v1/schemas/trace/v2.json` (committed as `src/schemas/trace-v2.schema.json`).

Every trace generated since #227 is v2. It is v1 plus everything the agents compute for a decision. v1 is published with `additionalProperties: false`, so these fields bump the version instead of changing v1:

| Field | Type | Notes |
|---|---|---|
| `sourcesUsed[]` | object | v1 keys plus `signalId`, `url`, `publisher`, `publishedAt` (#73). Each one is `null` when the signal does not carry it. |
| `provenance` | object | `{ schema, llm: [...], generator }` (#66). `llm` has at least one entry, because the hedge-condition fallback records a `source: "default"` entry. `fallbackFrom` and `generator.commit` are omitted, not nulled, when they don't apply. |
| `forecast` | object \| null | Ensemble members, weights and input digests (#75). Trader traces only. |
| `sizing` | object \| null | Kelly/correlation/final sizes and budget snapshot (#76). Trader traces only; includes `params: { version, hash }` (#274). |
| `riskParams` | object \| null | `{ scope, version, hash }` of the risk param snapshot the cycle started with (#274). Absent on older traces. |
| `seedPolicy` | object \| null | Seed-policy record (#82). Market-creation traces only. |
| `correlation` | object \| null | `{ pairs, method: "snapshot"\|"matrix", snapshotId }` (#80). Trader traces only. |
| `corroboration` | object \| null | `{ kind: "CORROBORATED"\|"AUTHORITATIVE"\|"UNCORROBORATED", units, domains }` (#228). Market-creation traces only; the corroborating signals are also in `sourcesUsed`. |

`createdAt` comes from `lib/clock`, so cassette replays produce identical bytes. `forecast`, `sizing`, `seedPolicy` and `correlation.pairs` are normalised to plain JSON before validation: `Date` values become ISO strings, `bigint` values become decimal strings, and non-finite numbers become `null`.

```json
{
  "schemaVersion": 2,
  "kind": "oracledesk.trace",
  "traceId": "11111111-1111-4111-8111-111111111111",
  "agentType": "MARKET_MAKER",
  "decisionType": "MARKET_CREATION",
  "action": "market_creation",
  "market": { "backendId": "22222222-2222-4222-8222-222222222222", "onChainId": null },
  "probabilityEstimate": 0.65,
  "marketProbability": 0.62,
  "edge": 0.03,
  "confidenceInterval": { "lower": 0.55, "upper": 0.75 },
  "sourcesUsed": [
    {
      "source": "NEWS",
      "weight": 0.8,
      "signal": "Fed signals a pause",
      "rawValue": null,
      "signalId": "sig_01",
      "url": "https://example.com/fed",
      "publisher": "Example Wire",
      "publishedAt": "2026-10-16T12:00:00.000Z"
    }
  ],
  "betFraction": null,
  "betSizeUsdc": null,
  "hedgeConditions": ["Close if market probability rises above 0.75"],
  "agentWallet": null,
  "createdAt": "2026-10-17T00:00:00.000Z",
  "provenance": {
    "schema": "oracledesk.trace.provenance/1",
    "llm": [
      { "source": "default", "promptId": "hedge-conditions", "promptVersion": 1, "reason": "LLM_FAILED" }
    ],
    "generator": { "service": "oracledesk-backend", "version": "1.0.0" }
  },
  "forecast": null,
  "sizing": null,
  "seedPolicy": { "seedRaw": "100000000", "initialYesBps": 6200 },
  "correlation": null,
  "corroboration": { "kind": "CORROBORATED", "units": 2, "domains": ["example.com", "wire.example.org"] }
}
```

### On-chain market id policy

- `market.onChainId` records what was known **when the decision was made**. `generateReasoningTrace` reads it from `markets.onChainMarketId`. It is usually `null` for market-creation traces, because the trace is generated before the creation transaction is confirmed, and it is set for trader traces on live markets.
- It is **never updated afterwards**. The payload is final when it is enqueued: no caller adds keys to it (the old top-level `onChainMarketId` spread is gone), and the pinned bytes define `traceHash`.
- The **authoritative link** is the registry entry's `market_id`. The publication worker reads it from `markets.onChainMarketId` at publish time and passes it to `publish_trace`.
- The worker validates the stored payload before pinning and again before publishing. A payload that declares `schemaVersion: 2` and fails the v2 schema, or whose `traceId` differs from the row's, fails with `TRACE_PAYLOAD_INVALID`. A v2 payload whose non-null `market.onChainId` differs from the market row's id fails with `TRACE_MARKET_MISMATCH`, so a trace is never registered under the wrong market. v1 and legacy payloads that were already enqueued keep pinning byte-for-byte as stored.

---

## 4. Confidential Trace Envelope (`oracledesk.trace.enc` v1)

When `TRACE_CONFIDENTIAL=true`, full traces are encrypted with XChaCha20-Poly1305 before pinning.

```json
{
  "kind": "oracledesk.trace.enc",
  "schemaVersion": 1,
  "alg": "XChaCha20-Poly1305",
  "kid": "kek-2026-10",
  "plaintextHash": "89b51fa16ce70...",
  "public": {
    "traceId": "11111111-1111-1111-1111-111111111111",
    "agentType": "MARKET_MAKER",
    "decisionType": "MARKET_CREATION",
    "market": {
      "backendId": "22222222-2222-2222-2222-222222222222",
      "onChainId": "0"
    },
    "probabilityEstimate": 0.65,
    "marketProbability": 0.5,
    "edge": 0.15,
    "previewSources": [
      {
        "source": "FRED",
        "weight": 0.8,
        "signal": "Federal funds futures imply 25bps cut",
        "rawValue": 0.75
      }
    ],
    "createdAt": "2026-10-17T00:00:00.000Z"
  },
  "nonce": "<base64 24 bytes>",
  "ciphertext": "<base64 ciphertext and 16-byte Poly1305 tag>"
}
```

- **AEAD Associated Data**: Canonical JSON bytes of the envelope excluding `nonce` and `ciphertext`.
- **Public Verifiability**:
  1. The on-chain `trace_hash` in `reasoning_registry` equals `sha256(pinned_bytes)` (the canonical envelope bytes).
  2. Entitled users unwrap the per-trace data key and decrypt the ciphertext to verify `sha256(plaintext) === envelope.plaintextHash`.

---

## 5. Question Document (v2)

JSON Schema URL: `https://api.oracledesk.io/api/v1/schemas/question/v2.json`

```json
{
  "schemaVersion": 2,
  "kind": "oracledesk.question",
  "question": "Will the Federal Reserve cut the target policy rate by 25bps or more at the Dec 2026 FOMC meeting?",
  "category": "FED",
  "contractCategory": "Macro",
  "closeTime": 1798761600,
  "resolutionSource": "FRED",
  "resolutionSpecHash": "a1b2c3d4...",
  "backendMarketId": "22222222-2222-2222-2222-222222222222"
}
```

## Recalibration fields (#244)

For TRADER traces, the `forecast` block (the ensemble) may carry:

| Field | Type | Meaning |
| ----- | ---- | ------- |
| `forecast.raw.p` | number | Ensemble probability before recalibration |
| `forecast.raw.ci` | `{ lower, upper }` | Ensemble 90% interval before recalibration |
| `forecast.calibration` | object \| null | `{ mapId, version, category, applied }` of the map behind `probabilityEstimate`; `applied: false` when recalibration is disabled |

`probabilityEstimate` and `confidenceInterval` are the values the trade was
sized on (after recalibration when applied). The database also stores
`rawProbabilityEstimate` per trace; it is not part of the pinned document.
Readers must treat all three fields as optional: traces written before #244
do not have them.

## Impact-aware sizing fields (#225)

TRADER traces size orders against the market's FPMM curve. The `sizing`
block carries an `impact` object describing the fill at `sizing.finalRaw`,
priced for the side bought. Every value is a string or an integer, so the
block is canonical-safe:

| Field | Type | Meaning |
| ----- | ---- | ------- |
| `sizing.impact.model` | string | `impact` (sized on the curve) or `mid` (closed-form Kelly at the mid, backtest comparison) |
| `sizing.impact.midBps` | integer | Price of the side bought before the trade |
| `sizing.impact.avgPriceBps` | integer | `collateral × 10 000 / shares`, fee included |
| `sizing.impact.postPriceBps` | integer | Price of the side bought after the trade |
| `sizing.impact.impactBps` | integer | Curve impact only: `(collateral − fee) × 10 000 / shares − midBps` |
| `sizing.impact.feeRaw` | string | Fee in collateral base units (the market's own `fee_bps`, rounded up) |
| `sizing.impact.expectedSharesRaw` | string | Shares out from `calcBuy` at the sized collateral |
| `sizing.impact.effectiveEdge` | string | Conservative probability minus average price, 6 decimals |
| `sizing.impact.poolLedger` | integer | Ledger the reserves are valid at |
| `sizing.impact.poolSource` | string | `indexed`, `rpc` or `sim` (backtest) |

`sizing.binding` may now also be `IMPACT`: the curve's optimum, below every
cap, set the size. `sizing.kellyRaw` is that optimum within the caps, before
correlation. Traces written before #225 have no `impact` block.
