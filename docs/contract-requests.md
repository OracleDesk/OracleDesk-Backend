# Requests for the contracts repo

Things this repo would like changed in
[OracleDesk-SmartContract](https://github.com/OracleDesk/OracleDesk-SmartContract)
(`oracledesk-stellar/`). The backend works around each one; none of them
block the port. File them there, not here.

## 1. Doc fix: wrong path to the FPMM TypeScript port

`docs/frontend-integration.md` line 73 says the sell-side math lives at
`agents/core/src/fpmm.ts`. The file is `agents/core/fpmm.ts` (there is no
`src/` directory under `agents/core`).

Verified with:

```bash
ls contracts/oracledesk-stellar/agents/core/src   # No such file or directory
ls contracts/oracledesk-stellar/agents/core/fpmm.ts
```

## 2. Publish the FPMM math with the bindings

`agents/core/fpmm.ts` is the only TypeScript implementation of the
contract's pricing math, and every client that wants `priceYesBps` or
"sell N shares" needs it. Today each consumer copies it out of `agents/`
(this repo does so in `scripts/sync-contracts.mjs`). Shipping it as part of a
bindings package, or as a tiny `@oracledesk/fpmm` package, would give it a
version number and remove the copy step.

## 3. A way to get test USDC

`deployments/testnet.json` points at a self-issued test USDC: the classic
asset `USDC:<deployer G-address>` wrapped in a Stellar Asset Contract
(`scripts/deploy-testnet.sh`, `stellar contract asset deploy`). A tester's
account needs a trustline to that asset, and only the deployer key can
`mint`. There is no faucet, so a new tester cannot get collateral without
asking a maintainer to mint by hand. A small, rate-limited
faucet script (or an admin `mint` helper in `scripts/`) would make the manual
test plan in `docs/manual-test.md` self-serve.

## 4. Export `ResolutionSpec` in the resolver bindings

The resolver contract hashes `ResolutionSpec` (an enum wrapping
`PriceConfig` or `SignerConfig`), but because no entrypoint takes it as an
argument it is not in the generated TypeScript. Off-chain code that needs
the commitment hash has to rebuild the XDR by hand. A no-op view function
that takes a `ResolutionSpec`, or a `spec_hash(spec) -> BytesN<32>` view,
would put the type in the spec and let clients ask the contract for the
hash instead of re-implementing it.

## 5. Make `agents/stellar/adapter.ts` usable as a library

The backend would rather depend on the agents package for signing than
duplicate it, but today the adapter:

- returns `{ dryRun: true, args }` in dry-run without building or
  simulating the transaction, so a dry run can't catch a contract error;
- imports bindings by npm package name (`@oracledesk/bindings-*`), which
  only resolve inside the contracts repo;
- has no `agentSell`.

If dry-run simulated (and returned the simulated result), the bindings were
injectable, and `agentSell` existed, `src/services/chain.service.ts` here
could become a thin wrapper around it. Its method names already match.

## 6. Adopt versioned reasoning trace schemas

The contracts repo (`agents/core/trace.ts`) currently defines a `ReasoningTrace` shape without versioning:
`{ agent: 'market-maker'|'trader', marketId: number|null, action, reasoning, inputs, timestamp: unix seconds }`.
The backend publishes versioned traces using `schemaVersion: 1` and `kind: 'oracledesk.trace'` (`docs/trace-format.md`), validating against a published JSON Schema 2020-12 at `https://api.oracledesk.io/api/v1/schemas/trace/v1.json`.
We request that the contracts repo:
- Adopt the `schemaVersion: 1` / `kind: 'oracledesk.trace'` envelope or publish its own formal JSON Schema.
- Use explicit `null` for optional fields to preserve canonical JSON byte stability.

## 7. x402 integration for confidential traces

When `TRACE_CONFIDENTIAL=true`, premium reasoning traces pinned to IPFS are sealed inside an authenticated encrypted envelope (`oracledesk.trace.enc` v1).
The contracts repo's x402 trace API (`x402/trace-api.ts`) should:
- Detect `kind === 'oracledesk.trace.enc'`.
- After payment verification, call the backend's internal key release endpoint:
  `POST /internal/traces/:onChainTraceId/key` with shared HMAC authentication (`X402_KEY_RELEASE_SECRET`), timestamp, and nonce replay protection.
- Decrypt the envelope using the retrieved data key and verify `sha256(plaintext) === envelope.plaintextHash` before returning the content to the paying user.

