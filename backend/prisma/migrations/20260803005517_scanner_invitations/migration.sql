-- CreateEnum
CREATE TYPE "EventScannerStatus" AS ENUM ('INVITED', 'PENDING', 'ACTIVE', 'DISABLED', 'REVOKED');

-- event_scanners no tiene filas todavía en este entorno (tabla nueva, sin
-- uso real todavía) — se reconstruyen las columnas directamente en vez de
-- migrar datos existentes.

-- DropForeignKey
ALTER TABLE "event_scanners" DROP CONSTRAINT "event_scanners_userId_fkey";

-- AlterTable
ALTER TABLE "event_scanners"
  DROP COLUMN "active",
  ALTER COLUMN "userId" DROP NOT NULL,
  ADD COLUMN "name" TEXT NOT NULL,
  ADD COLUMN "gate" TEXT NOT NULL,
  ADD COLUMN "status" "EventScannerStatus" NOT NULL DEFAULT 'INVITED',
  ADD COLUMN "invitationToken" TEXT NOT NULL,
  ADD COLUMN "invitationExpiresAt" TIMESTAMP(3),
  ADD COLUMN "createdBy" TEXT NOT NULL,
  ADD COLUMN "claimedAt" TIMESTAMP(3),
  ADD COLUMN "approvedBy" TEXT,
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "lastAccessAt" TIMESTAMP(3),
  ADD COLUMN "lastDevice" TEXT,
  ADD COLUMN "lastScanAt" TIMESTAMP(3),
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE UNIQUE INDEX "event_scanners_invitationToken_key" ON "event_scanners"("invitationToken");

-- AddForeignKey
ALTER TABLE "event_scanners" ADD CONSTRAINT "event_scanners_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
