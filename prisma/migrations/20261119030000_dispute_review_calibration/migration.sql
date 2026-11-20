-- Expand-only: add calibration columns to dispute_reviews.
-- Existing rows get NULL; labelReviews() fills them retroactively.

ALTER TABLE "dispute_reviews"
  ADD COLUMN "category"            "MarketCategory",
  ADD COLUMN "evaluator_provenance" jsonb,
  ADD COLUMN "evidence_class"       text,
  ADD COLUMN "final_outcome"        text,
  ADD COLUMN "proposal_correct"     boolean,
  ADD COLUMN "labelled_at"          timestamptz;

CREATE INDEX "dispute_reviews_labelled_at_idx" ON "dispute_reviews" ("labelled_at");
