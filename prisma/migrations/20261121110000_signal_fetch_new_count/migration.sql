-- Signal source health: novelty per fetch (#277).
SET lock_timeout = '5s';

ALTER TABLE "signal_fetches" ADD COLUMN "newCount" INTEGER;