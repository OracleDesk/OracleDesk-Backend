# Trace Signing Key Rotation Runbook (#273)

## Overview

Reasoning traces published to `reasoning-registry` are attested with a
dedicated Ed25519 key (`TRACE_SIGNING_KEY`) distinct from `AGENT_SECRET_KEY`,
`AUTH_SIGNING_SECRET`, `FEE_PAYER_SECRET`, `URI_REQUEST_SIGNING_SECRET`, and
all channel account keys.

## Zero-Downtime Rotation Procedure

1. **Generate a new Ed25519 key** (Stellar `S...` seed or 32-byte hex) outside
   of source control.
2. **Keep the current key active** while registering the new key via
   `POST /api/v1/admin/chain/signing-keys/register` (requires
   `chain.signing_keys` permission and step-up auth). The registry permits up to
   4 concurrent active keys per agent (`MAX_AGENT_SIGNING_KEYS`).
3. **Verify status** with `GET /api/v1/admin/chain/signing-keys` and confirm
   both the old and new keys appear in `active`.
4. **Roll out configuration**:
   - Set `TRACE_SIGNING_KEY` to the new secret seed.
   - Add the old 64-character hex public key to `TRACE_SIGNING_PREVIOUS_KEYS`
     so off-chain trace audits recognize historic signatures.
   - Wait for secret refresh or rolling deploy completion; the rotation listener
     zeroes retired seed buffers automatically.
5. **Drain in-flight trace publications** until no pending publication uses the
   old key.
6. **Retire the old key** via
   `POST /api/v1/admin/chain/signing-keys/<oldPublicKeyHex>/retire`.
   - Retiring removes the key from the active set while preserving its
     `KeyToAgent` binding on-chain, so historic signatures continue to verify.
   - A retired key can **never** be re-added (`KeyAlreadyBound`).

## Emergency Compromise Response

If `TRACE_SIGNING_KEY` is suspected compromised, retire it immediately via
`POST /api/v1/admin/chain/signing-keys/<compromisedPublicKeyHex>/retire`,
register a replacement key, and re-run `POST /api/v1/admin/trace-audit/run`.
