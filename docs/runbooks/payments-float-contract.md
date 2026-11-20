# Payments float removal: expand/contract rollout (#224)

Removes the Float money columns on payments and allowances:

| Table | Float (dropped) | Exact replacement |
| --- | --- | --- |
| `subscriptions` | `amountPaid` | `amountPaidRaw NUMERIC(39,0)` (new) |
| `payment_events` | `amount` | `amountRaw TEXT` (digits only) |
| `spending_allowances` | `dailyLimit`, `perTraceLimit`, `spentToday` | `dailyLimitRaw`, `perTraceLimitRaw`, `spentTodayRaw` |

API instances of two adjacent releases run side by side during a deploy, and
`scripts/check-migration-compat.mjs` refuses `DROP COLUMN` in a normal release.
The rollout therefore has three phases across at least two releases. Do not
skip or reorder them.

## Phase A: expand (release N)

Migration `prisma/migrations/20261120020000_payments_raw_expand` (additive,
passes the compat linter):

- `subscriptions.amountPaidRaw` plus `subscriptions_amount_paid_raw_nonneg`
  (`NOT VALID`).
- `DEFAULT 0` on every float column, so inserts that omit them succeed.
- `payment_events.reconciled` if it is missing (the #56 flag had no migration;
  `PaymentEvent` now maps to `payment_events`).
- `payment_raw_backfill`, the per-row backfill outcome table.

Release N's code dual-writes `amountPaidRaw` and still writes the floats
(`PAYMENT_FLOAT_WRITES=true`, the default). Every reader, DTO, the snapshot
exporter, the constraint audit and the seed already use raw values only.

What a release N-1 instance sees: new rows with both values, exactly as before.

## Backfill (after release N is fully deployed)

```sh
npm run backfill:payment-raw                     # dry-run: report only, writes nothing
npm run backfill:payment-raw -- --apply          # write raw values and outcomes
npm run backfill:payment-raw -- --apply --json backfill.json
```

Use an RPC endpoint with the longest retention available. The script reads
keyset batches of 500 (`--batch-size`) and is safe to interrupt and rerun.

| Rows | Exact source | Written |
| --- | --- | --- |
| `payment_events.amountRaw IS NULL` | SAC `transfer` events from `fromAddress` to `PAYMENTS_RECIPIENT` in `getTransaction(txHash)`, net of refunds | when it equals `usdcFromNumber(amount)` |
| `subscriptions.amountPaidRaw IS NULL` | `payment_events.amountRaw` joined by `txHash`, else that event's backfill outcome | when it equals `usdcFromNumber(amountPaid)` |
| `spending_allowances` created before `20261019120000_allowance_accounting` | `dailyLimitRaw` / `perTraceLimitRaw` | never (raw wins; divergences are reported) |

Outcomes in `payment_raw_backfill.status`:

- `VERIFIED`: the exact source equals the float. Written.
- `FLOAT_ONLY`: no exact source remains (transaction outside RPC retention or
  without a recorded ledger, subscription without `txHash` or payment event).
  The float candidate is written, and the row stays recorded as `FLOAT_ONLY`
  so it is never mistaken for a verified amount.
- `MISMATCH`: the chain (or the exact event amount) disagrees with the float.
  Not written. The script exits 1 while any exist.
- `NOT_FOUND`: the transaction is missing although its ledger is inside RPC
  retention, failed, or carries no matching transfer. Not written; the exit
  code is unaffected, but these rows block phase C like a MISMATCH.

A recorded `MISMATCH`/`NOT_FOUND` is reused on rerun without calling RPC;
pass `--recheck` to query again.

### Resolving a MISMATCH or NOT_FOUND

Inspect the row, its transaction and the recorded values:

```sql
SELECT * FROM payment_raw_backfill WHERE status IN ('MISMATCH', 'NOT_FOUND') ORDER BY "table", "rowId";
```

`chainValue` is what the chain moved and is authoritative. After review, write
it (or the value the review settles on) and rerun the backfill so dependent
subscriptions follow:

```sql
UPDATE payment_events SET "amountRaw" = '<base units>' WHERE id = '<id>' AND "amountRaw" IS NULL;
UPDATE subscriptions SET "amountPaidRaw" = <base units> WHERE id = '<id>' AND "amountPaidRaw" IS NULL;
```

## Phase B: stop float writes (release N, after the backfill)

Once **every** instance runs release N (no N-1 pods left):

1. Set `PAYMENT_FLOAT_WRITES=false` and roll the deployment. Writers omit the
   floats and the `DEFAULT 0` applies. No reader treats `0` as a real amount.
2. Rerun `npm run backfill:payment-raw -- --apply` and confirm it exits 0 with
   no `NOT_FOUND`.

Rollback: set `PAYMENT_FLOAT_WRITES=true` again. Rows written while it was
false keep a float of `0`; nothing reads it.

Accepted during the transition: `Idempotency-Key` replays of responses cached
before release N may still show the old float fields until the key expires
(24 h). Release N-1 instances return raw Prisma rows, so for rows written with
`PAYMENT_FLOAT_WRITES=false` they would show a float of `0`; that is why phase B
waits for N-1 to be gone.

## Phase C: contract (release N+1 or later)

The migration is staged at
`prisma/migrations-pending/20261120030000_payments_float_contract/migration.sql`.
It is outside `prisma/migrations/`, so `prisma migrate deploy` does not run it.

### Preconditions (all must hold)

- Phase B has been live on every instance and environment.
- `npm run backfill:payment-raw` exits 0 against production, and:

  ```sql
  SELECT count(*) FROM payment_events WHERE "amountRaw" IS NULL;        -- 0
  SELECT count(*) FROM subscriptions  WHERE "amountPaidRaw" IS NULL;    -- 0
  ```

  (Every MISMATCH/NOT_FOUND row is still NULL until resolved, so these
  counts cover them.)

- A fresh backup exists (`docs/runbooks/backup-restore.md`).

### The contract PR

In one PR, labelled **`migration:breaking`**:

1. `git mv` the pending folder into `prisma/migrations/`, renamed to a
   timestamp later than the newest migration, and update
   `prisma/migrations-pending/README.md`.
2. `prisma/schema.prisma`: delete `Subscription.amountPaid`,
   `PaymentEvent.amount`, `SpendingAllowance.dailyLimit` / `perTraceLimit` /
   `spentToday` and their `CHECK` doc comments (the float `*_nonneg`
   constraints are dropped with their columns), and update the
   `amountPaidRaw` comment (the CHECK is now validated).
3. Remove `PAYMENT_FLOAT_WRITES` from `src/config/index.ts` and
   `.env.example`, and `floatMirror` with its call sites in
   `subscription.service.ts` and `payment-intent.service.ts`.
4. `scripts/backfill-payment-raw.ts` reads the float columns; delete it (its
   outcomes stay in `payment_raw_backfill`) or drop the float reads.
5. Update the float mentions in `docs/architecture.md` and `docs/api.md`.

CI: `npm run check:drift` must pass. `scripts/check-migration-compat.mjs`
reports `drop-column` and fails; that is expected. Deploy with the reusable
workflow input `allow_breaking_migrations: true`, which makes
`.github/workflows/deploy-env.yml` pass `--allow-breaking`.

### Rollback

The drop is not reversible in place. Before the contract is applied, roll back
by reverting the release. After it, restore the float columns only from a
backup; the application no longer needs them, so prefer rolling forward.
