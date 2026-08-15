-- CreateEnum
CREATE TYPE "WhatsappInboundMessageClaimStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "whatsapp_inbound_message_claims" (
    "id" TEXT NOT NULL,
    "wamid" TEXT NOT NULL,
    "status" "WhatsappInboundMessageClaimStatus" NOT NULL DEFAULT 'PROCESSING',
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "leaseExpiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_inbound_message_claims_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_inbound_message_claims_wamid_key" ON "whatsapp_inbound_message_claims"("wamid");

-- CreateIndex
CREATE INDEX "whatsapp_inbound_message_claims_status_leaseExpiresAt_idx" ON "whatsapp_inbound_message_claims"("status", "leaseExpiresAt");
