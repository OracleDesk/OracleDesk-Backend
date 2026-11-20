SET lock_timeout = '5s';

-- Persist the wallet used to sign each copy trade. Historical intents use
-- their owner's current base wallet as the only available source.
ALTER TABLE "copy_trades" ADD COLUMN "followerWallet" TEXT;

UPDATE "copy_trades" AS ct
SET "followerWallet" = u."walletAddress"
FROM "users" AS u
WHERE ct."userId" = u."id";

ALTER TABLE "copy_trades" ALTER COLUMN "followerWallet" SET NOT NULL;

CREATE INDEX "copy_trades_followerWallet_status_idx"
ON "copy_trades"("followerWallet", "status");
