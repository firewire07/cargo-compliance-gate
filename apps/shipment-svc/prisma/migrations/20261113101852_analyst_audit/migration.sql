-- AlterTable
ALTER TABLE "shipment"."holds" ADD COLUMN     "checklist" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "releaseApprovedAt" TIMESTAMP(3),
ADD COLUMN     "releaseApprovedBy" TEXT,
ADD COLUMN     "releaseRejectedAt" TIMESTAMP(3),
ADD COLUMN     "releaseRejectedBy" TEXT,
ADD COLUMN     "releaseRejectionReason" TEXT,
ADD COLUMN     "releaseRequestedAt" TIMESTAMP(3),
ADD COLUMN     "releaseRequestedBy" TEXT;

-- CreateTable
CREATE TABLE "shipment"."audit_entries" (
    "seq" SERIAL NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "awb" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "prevHash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,

    CONSTRAINT "audit_entries_pkey" PRIMARY KEY ("seq")
);

-- CreateIndex
CREATE UNIQUE INDEX "audit_entries_eventId_key" ON "shipment"."audit_entries"("eventId");

-- CreateIndex
CREATE INDEX "audit_entries_awb_seq_idx" ON "shipment"."audit_entries"("awb", "seq");
