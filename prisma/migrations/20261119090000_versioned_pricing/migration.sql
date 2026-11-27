SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS "price_schedules" (
  "id" TEXT PRIMARY KEY,
  "version" INTEGER NOT NULL UNIQUE,
  "dailyPassPriceRaw" TEXT NOT NULL,
  "perTracePriceRaw" TEXT NOT NULL,
  "effectiveAt" TIMESTAMP(3) NOT NULL UNIQUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "price_schedules_daily_price_positive" CHECK ("dailyPassPriceRaw" ~ '^[0-9]+$' AND "dailyPassPriceRaw"::numeric > 0)
);

ALTER TABLE "payment_intents" ADD COLUMN IF NOT EXISTS "priceScheduleVersion" INTEGER;
ALTER TABLE "payment_events" ADD COLUMN IF NOT EXISTS "priceScheduleVersion" INTEGER;
