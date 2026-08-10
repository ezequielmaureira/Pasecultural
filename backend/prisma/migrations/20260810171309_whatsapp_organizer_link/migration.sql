-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "whatsappLinkAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "whatsappLinkAttemptsAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "whatsapp_link_challenges" (
    "id" TEXT NOT NULL,
    "waId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSentAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_link_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_organizer_links" (
    "id" TEXT NOT NULL,
    "waId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_organizer_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_link_challenges_waId_key" ON "whatsapp_link_challenges"("waId");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_organizer_links_waId_key" ON "whatsapp_organizer_links"("waId");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_organizer_links_organizationId_key" ON "whatsapp_organizer_links"("organizationId");

-- AddForeignKey
ALTER TABLE "whatsapp_organizer_links" ADD CONSTRAINT "whatsapp_organizer_links_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
