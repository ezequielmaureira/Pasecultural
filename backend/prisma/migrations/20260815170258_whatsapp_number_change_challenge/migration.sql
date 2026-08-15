-- CreateEnum
CREATE TYPE "WhatsappNumberChangePurpose" AS ENUM ('CHANGE_WHATSAPP_NUMBER');

-- CreateTable
CREATE TABLE "whatsapp_number_change_challenges" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "purpose" "WhatsappNumberChangePurpose" NOT NULL DEFAULT 'CHANGE_WHATSAPP_NUMBER',
    "oldWaId" TEXT,
    "newWaId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSentAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_number_change_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_number_change_challenges_organizationId_key" ON "whatsapp_number_change_challenges"("organizationId");

-- AddForeignKey
ALTER TABLE "whatsapp_number_change_challenges" ADD CONSTRAINT "whatsapp_number_change_challenges_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_number_change_challenges" ADD CONSTRAINT "whatsapp_number_change_challenges_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
