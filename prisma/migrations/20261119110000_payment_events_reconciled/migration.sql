-- #56 added PaymentEvent.reconciled to the schema without a migration, so
-- every payment_events insert failed against a migrated database.
SET lock_timeout = '5s';

ALTER TABLE "payment_events" ADD COLUMN "reconciled" BOOLEAN NOT NULL DEFAULT false;
