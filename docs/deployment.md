# Deployment (#144)

## Pipeline

1. **Verify** — CI jobs (contract sync, migrations, build, tests, actionlint,
   shellcheck).
2. **Image** — buildx pushes `ghcr.io/<repo>@sha256:<digest>`, cosign signs the
   digest, Syft emits an SPDX SBOM.
3. **Staging** — `deploy-env.yml` verifies the cosign identity, lints migrations
   and runs `helm upgrade --install --atomic`.
4. **Staging checks** — readiness must hold 3 consecutive probes, indexer lag
   must be ≤ 120 ledgers and the cursor must advance.
5. **Production** — same reusable workflow with the production GitHub
   Environment (required reviewers).
6. **Production checks** — 5 consecutive readiness probes plus the same lag,
   cursor and Prometheus checks.

Secrets (kubeconfig, Helm values) live in GitHub Environments. The image is
referenced by digest, never by a mutable tag.

## Migration rule: expand / contract

`scripts/check-migration-compat.mjs` (run on the migrations changed in a PR/release) blocks:

- `DROP TABLE`, `DROP COLUMN`, `RENAME`;
- `ALTER COLUMN … TYPE`;
- `SET NOT NULL`;
- `CREATE INDEX` without `CONCURRENTLY`.

Ship additive migrations first, deploy both versions, then remove old columns
in a later release. `--allow-breaking` exists only for an explicitly approved
maintenance window.

## Admin RBAC first deploy (#49)

Ship the `20261019110000_admin_rbac` migration before the new image. On first
boot the process seeds the fixed permission/role catalogue and assigns every
`ADMIN_ADDRESSES` entry as `super_admin` under an advisory lock. After that the
database is authoritative: removing an address from the environment does **not**
revoke it, and the env list is never consulted per request. Grant/revoke and
treasury writes require a wallet proof no older than `STEP_UP_MAX_AGE_SECONDS`.
If the seed cannot complete, the process refuses to boot rather than serve
without an admin role catalogue.

## Payment intent confirmer (#52)

`startPaymentIntentCron` runs every `PAYMENT_INTENT_CONFIRM_CRON` (default
`*/20 * * * * *`) and uses the same per-hash advisory lock as the legacy unlock,
so all replicas can schedule it safely. It is bounded by
`PAYMENT_INTENT_CONFIRM_BATCH` and backs off up to
`PAYMENT_INTENT_MAX_ATTEMPTS`. Set `PAYMENT_INTENT_CONFIRM_ENABLED=false` to
pause it without blocking interactive `POST /…/submit` calls.

## Rollback

Roll back the Helm release to the previous revision. If the new release added
only expand-phase changes, the old code keeps working. Do **not** roll back the
database; forward-fix instead.

## Post-deploy checks

```bash
API_URL=https://api.example \
INDEXER_STATUS_URL=https://api.example/internal/indexer-status \
MAX_INDEXER_LAG_LEDGERS=120 \
PROMETHEUS_URL=https://prometheus.example \
KUBE_NAMESPACE=oracledesk DEPLOYMENTS="api indexer worker" \
DIGEST=<sha256> ./scripts/post-deploy-checks.sh
```

Checks are read-only. `SKIP_KUBE=1` omits the digest check in local tests.

## IPFS pin garbage collection (#328)

Pins are tracked in `ipfs_pins` / `ipfs_pin_refs` (see `docs/trace-format.md`). A GC job (`src/jobs/pin-gc.job.ts`)
runs hourly from the monitor cron on every instance; it is safe to run concurrently because it claims pins with
`FOR UPDATE SKIP LOCKED`.

| Variable | Default | Meaning |
|---|---|---|
| `PIN_GC_ENABLED` | `false` | Turn the job on. Leave off until the reconciliation below has run. |
| `PIN_GC_GRACE_HOURS` | `72` | How long an owner that never reached the chain is kept before its pin is released. |
| `PIN_GC_BATCH` | `50` | Maximum pins claimed per run. |
| `PIN_GC_RATE_PER_MIN` | `30` | Provider unpin calls per minute. Repeated HTTP 429 stops the run; nothing is lost. |

Roll-out:

1. Deploy and run `npx prisma migrate deploy`.
2. Import the pins that already exist: `npm run pins:reconcile` (dry run), then `npm run pins:reconcile -- --execute`.
   Pins with no known owner are only collected after the grace period; review them first.
3. Set `PIN_GC_ENABLED=true`.

`scripts/unpin-legacy-traces.ts` was removed: the reconciliation plus the GC replace it.
