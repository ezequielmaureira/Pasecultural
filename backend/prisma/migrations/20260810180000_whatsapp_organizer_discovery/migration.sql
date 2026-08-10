-- AlterTable
ALTER TABLE "conversation_states" ADD COLUMN     "organizationId" TEXT;

-- DropIndex
DROP INDEX "whatsapp_organizer_links_waId_key";

-- CreateIndex
CREATE INDEX "whatsapp_organizer_links_waId_idx" ON "whatsapp_organizer_links"("waId");

-- CreateEnum
CREATE TYPE "WhatsappPendingSelectionStatus" AS ENUM ('AWAITING_SELECTION', 'AWAITING_CONFIRMATION');

-- CreateTable
CREATE TABLE "whatsapp_pending_organization_selections" (
    "id" TEXT NOT NULL,
    "waId" TEXT NOT NULL,
    "status" "WhatsappPendingSelectionStatus" NOT NULL,
    "candidateOrganizationIds" JSONB NOT NULL,
    "selectedOrganizationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_pending_organization_selections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_pending_organization_selections_waId_key" ON "whatsapp_pending_organization_selections"("waId");
