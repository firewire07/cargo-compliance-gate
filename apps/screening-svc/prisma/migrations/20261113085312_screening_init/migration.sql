-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "screening";

-- CreateEnum
CREATE TYPE "screening"."CheckType" AS ENUM ('DG', 'EMBARGO', 'SANCTIONS');

-- CreateEnum
CREATE TYPE "screening"."CheckOutcome" AS ENUM ('PASS', 'HIT');

-- CreateTable
CREATE TABLE "screening"."screening_results" (
    "id" UUID NOT NULL,
    "awb" TEXT NOT NULL,
    "shipmentVersion" INTEGER NOT NULL,
    "check" "screening"."CheckType" NOT NULL,
    "outcome" "screening"."CheckOutcome" NOT NULL,
    "ruleVersion" TEXT NOT NULL,
    "score" DOUBLE PRECISION,
    "reasons" JSONB NOT NULL,
    "inputs" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "screening_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "screening"."processed_events" (
    "eventId" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_events_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "screening"."outbox" (
    "id" UUID NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "screening_results_awb_shipmentVersion_check_key" ON "screening"."screening_results"("awb", "shipmentVersion", "check");

-- CreateIndex
CREATE INDEX "outbox_sentAt_createdAt_idx" ON "screening"."outbox"("sentAt", "createdAt");
