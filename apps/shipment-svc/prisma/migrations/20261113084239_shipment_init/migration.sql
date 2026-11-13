-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "shipment";

-- CreateEnum
CREATE TYPE "shipment"."PartyRole" AS ENUM ('SHIPPER', 'CONSIGNEE');

-- CreateEnum
CREATE TYPE "shipment"."ShipmentStatus" AS ENUM ('SUBMITTED', 'CHECKING', 'HELD', 'CLEARED', 'RELEASED');

-- CreateTable
CREATE TABLE "shipment"."shipments" (
    "id" UUID NOT NULL,
    "awb" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "pieces" INTEGER NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "goodsDescription" TEXT NOT NULL,
    "hsCode" TEXT,
    "unNumber" TEXT,
    "routing" TEXT NOT NULL,
    "status" "shipment"."ShipmentStatus" NOT NULL DEFAULT 'SUBMITTED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment"."parties" (
    "id" UUID NOT NULL,
    "role" "shipment"."PartyRole" NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "shipmentId" UUID NOT NULL,

    CONSTRAINT "parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment"."outbox" (
    "id" UUID NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shipments_awb_key" ON "shipment"."shipments"("awb");

-- CreateIndex
CREATE INDEX "outbox_sentAt_createdAt_idx" ON "shipment"."outbox"("sentAt", "createdAt");

-- AddForeignKey
ALTER TABLE "shipment"."parties" ADD CONSTRAINT "parties_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipment"."shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
