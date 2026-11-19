SET lock_timeout = '5s';

-- Remote IPFS pin ledger (#328). New tables only; no data migration.
CREATE TABLE "ipfs_pins" (
    "cid" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "repinRequested" BOOLEAN NOT NULL DEFAULT false,
    "pinnedAt" TIMESTAMP(3),
    "unpinnedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ipfs_pins_pkey" PRIMARY KEY ("cid")
);

CREATE TABLE "ipfs_pin_refs" (
    "id" TEXT NOT NULL,
    "cid" TEXT NOT NULL,
    "ownerKind" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'CANDIDATE',
    "anchoredAt" TIMESTAMP(3),
    "anchor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ipfs_pin_refs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ipfs_pins_status_idx" ON "ipfs_pins"("status");
CREATE INDEX "ipfs_pin_refs_ownerKind_ownerId_idx" ON "ipfs_pin_refs"("ownerKind", "ownerId");
CREATE INDEX "ipfs_pin_refs_state_idx" ON "ipfs_pin_refs"("state");
CREATE UNIQUE INDEX "ipfs_pin_refs_cid_ownerKind_ownerId_key" ON "ipfs_pin_refs"("cid", "ownerKind", "ownerId");

ALTER TABLE "ipfs_pin_refs" ADD CONSTRAINT "ipfs_pin_refs_cid_fkey" FOREIGN KEY ("cid") REFERENCES "ipfs_pins"("cid") ON DELETE RESTRICT ON UPDATE CASCADE;
