-- CreateEnum
CREATE TYPE "shipment"."CheckType" AS ENUM ('DG', 'EMBARGO', 'SANCTIONS');

-- AlterTable
ALTER TABLE "shipment"."outbox" ADD COLUMN     "topic" TEXT NOT NULL DEFAULT 'shipment.events';

-- CreateTable
CREATE TABLE "shipment"."pending_checks" (
    "id" UUID NOT NULL,
    "awb" TEXT NOT NULL,
    "shipmentVersion" INTEGER NOT NULL,
    "expected" "shipment"."CheckType"[],
    "received" JSONB NOT NULL DEFAULT '[]',
    "deadline" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment"."holds" (
    "id" UUID NOT NULL,
    "awb" TEXT NOT NULL,
    "shipmentVersion" INTEGER NOT NULL,
    "reasons" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment"."processed_events" (
    "eventId" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_events_pkey" PRIMARY KEY ("eventId")
);

-- CreateIndex
CREATE INDEX "pending_checks_decidedAt_deadline_idx" ON "shipment"."pending_checks"("decidedAt", "deadline");

-- CreateIndex
CREATE UNIQUE INDEX "pending_checks_awb_shipmentVersion_key" ON "shipment"."pending_checks"("awb", "shipmentVersion");

-- CreateIndex
CREATE INDEX "holds_awb_idx" ON "shipment"."holds"("awb");
