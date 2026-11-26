ALTER TABLE "dispute_reviews" ADD COLUMN "manifestHash" TEXT;
ALTER TABLE "dispute_reviews" ADD COLUMN "promptHash" TEXT;
ALTER TABLE "dispute_reviews" ADD COLUMN "evaluatedAt" TIMESTAMP(3);
