# Treasury SEP-7 Signing Key Runbook (#270)

## Overview

OracleDesk signs per-signer SEP-7 transaction URIs (`web+stellar:tx?...`) using a
dedicated Ed25519 key (`URI_REQUEST_SIGNING_SECRET`). The matching public key is
published at `https://<SEP7_ORIGIN_DOMAIN>/.well-known/stellar.toml` under
`URI_REQUEST_SIGNING_KEY`.

This key **only** signs SEP-7 URI requests so wallets can authenticate the
request origin. It must never be funded, added as a treasury signer, or reused
for `AUTH_SIGNING_SECRET`, `AGENT_SECRET_KEY`, `FEE_PAYER_SECRET`, or
`TRACE_SIGNING_KEY`.

## Reverse-proxy Requirement

Compliant wallets fetch `https://<SEP7_ORIGIN_DOMAIN>/.well-known/stellar.toml`
from the `origin_domain` apex/host named in the URI. If the backend API runs on
a subdomain (e.g. `api.oracledesk.example`), configure the edge reverse proxy on
`SEP7_ORIGIN_DOMAIN` to proxy `/.well-known/stellar.toml` to the backend's
`GET /.well-known/stellar.toml` endpoint, preserving `Content-Type: text/plain`
and `Access-Control-Allow-Origin: *`.

## Rotating `URI_REQUEST_SIGNING_SECRET`

Wallets cache the last-seen `URI_REQUEST_SIGNING_KEY` per `origin_domain` and
may display a security warning when the key changes. Follow this procedure:

1. **Announce the rotation** to all treasury multisig holders before changing
   the key so wallet key-change warnings are expected.
2. **Generate a fresh Ed25519 keypair** offline or via your secret manager
   (never reuse any existing Stellar secret seed).
3. **Wait for active operations to settle or revoke open requests**: existing
   `ISSUED` SEP-7 URIs signed with the old key will fail wallet verification
   once `/.well-known/stellar.toml` updates.
4. **Update `URI_REQUEST_SIGNING_SECRET`** in Vault / Kubernetes Secret (and
   confirm `GET /.well-known/stellar.toml` reflects the new
   `URI_REQUEST_SIGNING_KEY`).
5. **Re-issue SEP-7 URIs** via `POST /api/v1/admin/treasury/operations/:id/sep7`
   for any in-flight `PREPARED` or `PARTIALLY_SIGNED` operation (re-issuing
   automatically revokes the previous tokens).
6. **Verify** with a test dry-run operation before signing a production action.
