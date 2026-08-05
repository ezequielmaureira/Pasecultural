/*
  Warnings:

  - You are about to drop the column `scannedBy` on the `check_ins` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "CheckInSource" AS ENUM ('SCAN', 'MANUAL');

-- CreateEnum
CREATE TYPE "TicketAuditAction" AS ENUM ('CANCEL', 'REHABILITATE', 'REACTIVATE', 'MARK_USED_MANUAL', 'SOFT_DELETE');

-- CreateEnum
CREATE TYPE "TicketAuditActorType" AS ENUM ('SCANNER', 'ORGANIZER', 'SYSTEM');

-- DropIndex
DROP INDEX "check_ins_ticketId_key";

-- AlterTable
ALTER TABLE "check_ins" DROP COLUMN "scannedBy",
ADD COLUMN     "device" TEXT,
ADD COLUMN     "scannerId" TEXT,
ADD COLUMN     "source" "CheckInSource" NOT NULL DEFAULT 'SCAN';

-- AlterTable
ALTER TABLE "scan_attempts" ADD COLUMN     "gate" TEXT;

-- CreateTable
CREATE TABLE "ticket_audit_logs" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "action" "TicketAuditAction" NOT NULL,
    "fromStatus" "TicketStatus",
    "toStatus" "TicketStatus",
    "actorType" "TicketAuditActorType" NOT NULL,
    "actorId" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_audit_logs_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ticket_audit_logs" ADD CONSTRAINT "ticket_audit_logs_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
