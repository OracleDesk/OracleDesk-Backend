CREATE TABLE IF NOT EXISTS "status_transition_audit" (
  "table_name" TEXT NOT NULL,
  "column_name" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "count" BIGINT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("table_name", "column_name", "value")
);

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('signer_attestations','status'), ('position_exits','status'),
    ('admin_operations','status'), ('dispute_reviews','verdict'),
    ('dispute_reviews','resolvedAs'), ('alert_deliveries','status'),
    ('alert_deliveries','level')
  ) AS x(table_name, column_name) LOOP
    EXECUTE format('INSERT INTO status_transition_audit(table_name,column_name,value,count) SELECT %L,%L,%I,COUNT(*) FROM %I GROUP BY %I ON CONFLICT DO NOTHING', r.table_name, r.column_name, r.column_name, r.table_name, r.column_name);
  END LOOP;
END $$;

ALTER TABLE "signer_attestations" ADD CONSTRAINT "signer_attestations_status_check" CHECK ("status" IN ('PREPARED','SUBMITTED','CONFIRMED','FAILED')) NOT VALID;
ALTER TABLE "position_exits" ADD CONSTRAINT "position_exits_status_check" CHECK ("status" IN ('SUBMITTED','CONFIRMED','FAILED','SIMULATED')) NOT VALID;
ALTER TABLE "admin_operations" ADD CONSTRAINT "admin_operations_status_check" CHECK ("status" IN ('PREPARED','PARTIALLY_SIGNED','READY','SUBMITTED','SUCCESS','FAILED','EXPIRED','CANCELLED')) NOT VALID;
ALTER TABLE "dispute_reviews" ADD CONSTRAINT "dispute_reviews_verdict_check" CHECK ("verdict" IN ('PENDING','AGREE','DISAGREE','INSUFFICIENT','ERROR')) NOT VALID;
ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliveries_status_check" CHECK ("status" IN ('SENT','FAILED')) NOT VALID;
