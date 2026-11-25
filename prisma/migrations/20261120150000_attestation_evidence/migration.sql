CREATE TABLE "attestation_evidence" (
  "id" TEXT NOT NULL,
  "marketId" TEXT NOT NULL,
  "onChainMarketId" BIGINT NOT NULL,
  "signer" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "bundleCid" TEXT NOT NULL,
  "bundleHash" CHAR(64) NOT NULL,
  "bundle" JSONB NOT NULL,
  "traceTxXdr" TEXT,
  "traceTxHash" TEXT,
  "onChainTraceId" BIGINT,
  "status" TEXT NOT NULL DEFAULT 'BUNDLED',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "attestation_evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attestation_evidence_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "markets"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "attestation_evidence_market_signer_outcome_hash_key" ON "attestation_evidence"("onChainMarketId", "signer", "outcome", "bundleHash");
CREATE INDEX "attestation_evidence_marketId_idx" ON "attestation_evidence"("marketId");
CREATE INDEX "attestation_evidence_onChainTraceId_idx" ON "attestation_evidence"("onChainTraceId");
ALTER TABLE "signer_attestations" ADD COLUMN "evidenceId" TEXT, ADD COLUMN "evidenceTraceId" BIGINT;
CREATE INDEX "signer_attestations_evidenceId_idx" ON "signer_attestations"("evidenceId");
ALTER TABLE "signer_attestations" ADD CONSTRAINT "signer_attestations_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "attestation_evidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;
