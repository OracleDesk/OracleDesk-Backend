# Pending (contract) migrations

Migrations in this directory are **not** applied by `prisma migrate deploy`:
Prisma only reads `prisma/migrations/`. They are the contract half of an
expand/contract rollout and must ship in a later release than their expand
migration, once every running instance has stopped depending on the objects
they drop.

`prisma/schema.prisma` describes the database *without* these migrations.

| Migration | Issue | Expand half | Runbook |
| --- | --- | --- | --- |
| `20261120030000_payments_float_contract` | #224 | `20261120020000_payments_raw_expand` | `docs/runbooks/payments-float-contract.md` |

## Promoting one

1. Check every precondition in its runbook.
2. `git mv` the folder into `prisma/migrations/`, renaming it to a timestamp
   later than the newest existing migration (`scripts/lint-migrations.sh`
   rejects a non-increasing prefix).
3. Apply the schema changes the runbook lists in the same PR, so
   `npm run check:drift` stays clean.
4. Label the PR `migration:breaking`. `scripts/check-migration-compat.mjs`
   fails on it without `--allow-breaking`; the deploy workflow passes that flag
   only when the caller sets `allow_breaking_migrations: true`.
