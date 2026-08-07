-- CreateEnum
CREATE TYPE "SaleOrigin" AS ENUM ('SALE', 'COURTESY');

-- CreateEnum
CREATE TYPE "CourtesyReason" AS ENUM ('SPONSOR', 'PRENSA', 'INVITADO', 'STAFF', 'ARTISTA', 'FAMILIAR', 'PROTOCOLO', 'OTRO');

-- CreateEnum
CREATE TYPE "CourtesyDeliveryMethod" AS ENUM ('SHARE', 'EMAIL');

-- AlterTable
-- DEFAULT 'SALE' a propósito: todas las filas existentes quedan
-- clasificadas como venta real sin necesidad de backfill.
ALTER TABLE "sales" ADD COLUMN "origin" "SaleOrigin" NOT NULL DEFAULT 'SALE';

-- CreateTable
CREATE TABLE "courtesy_issuances" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "reason" "CourtesyReason",
    "reasonNote" TEXT,
    "deliveryMethod" "CourtesyDeliveryMethod" NOT NULL,
    "recipientEmail" TEXT,
    "issuedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courtesy_issuances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "courtesy_issuances_saleId_key" ON "courtesy_issuances"("saleId");

-- AddForeignKey
ALTER TABLE "courtesy_issuances" ADD CONSTRAINT "courtesy_issuances_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courtesy_issuances" ADD CONSTRAINT "courtesy_issuances_issuedByUserId_fkey" FOREIGN KEY ("issuedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
