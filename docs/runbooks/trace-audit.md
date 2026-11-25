# Trace Audit & Governance Verdict Runbook (#150, #306)

## Architecture

- **Full audit (`TRACE_AUDIT_CRON`, default `40 */2 * * *`)**: walks `reasoning_registry` on-chain traces, verifies pinned IPFS bytes against `trace_hash`, and evaluates `trace_verdict` within a reserved fraction (`TRACE_AUDIT_VERDICT_RPC_SHARE`, default `0.3`) of `TRACE_AUDIT_MAX_RPC`.
- **Fast-lane verdict recheck (`TRACE_VERDICT_CRON`, default `*/10 * * * *`)**: re-checks priority classes (a) non-`VALID` traces and (b) traces of agents in `agent_revocations`, capped at `TRACE_VERDICT_MAX_RPC` (default `100`). Shares the single-run guard with the full audit so the two never overlap.
- **Indexer hooks**: `TraceFlagged`, `TraceUnflagged`, and `AgentRevoked` events schedule an immediate `runVerdictRecheck` against the authoritative chain state (and upsert `agent_revocations` on revocation).

## Incident Response

### 1. Backend Trace `FLAGGED` Alert (`CRITICAL`)

1. Inspect the trace via `GET /api/v1/traces/:id` and review the flag history in `trace_flag_events` for the trace's `onChainTraceId`.
2. Confirm that `verified` is `false` and `POST /api/v1/trade/copy` refuses the trace with `409 TRACE_NOT_TRUSTED`.
3. Investigate the root cause of the flag reason with the registry governance operator.
4. Once governance calls `unflag_trace`, the `TraceUnflagged` indexer event (or the 10-minute fast lane) re-queries `trace_verdict`, increments `verdictVersion`, restores `VALID` / `verified: true`, and updates ETags.

### 2. Backend Agent `AGENT_REVOKED_AFTER` Alert (`CRITICAL`)

1. The backend automatically pauses **all** agent scopes via `pauseAgent('ALL', { source: 'operator', actor: 'system', reason: 'agent revoked in registry' })`.
2. Verify pause state at `GET /api/v1/admin/agents/controls`.
3. Check `agent_revocations` for `effective_from`, `reason`, and `observed_ledger`.
4. Do **not** resume agents (`POST /api/v1/admin/agents/ALL/resume`) until the compromised key/issue is rotated or resolved with registry governance and a fresh agent key is registered on-chain.

### 3. RPC Budget Exhaustion

- Inspect `TraceAuditRun.stats.rpcCallsByCategory` (`discovery`, `hashAudit`, `verdict`, `flags`) via `GET /api/v1/admin/trace-audit`.
- Adjust `TRACE_AUDIT_MAX_RPC`, `TRACE_AUDIT_VERDICT_RPC_SHARE`, or `TRACE_VERDICT_MAX_RPC` if verdict checks lag behind during bulk flag/revocation waves.
