/*
  Warnings:

  - You are about to drop the column `functionId` on the `ticket_types` table. All the data in the column will be lost.
  - Added the required column `eventId` to the `ticket_types` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "ticket_types" DROP CONSTRAINT "ticket_types_functionId_fkey";

-- AlterTable
ALTER TABLE "event_functions" ADD COLUMN     "recurrenceGroupId" TEXT;

-- AlterTable
ALTER TABLE "ticket_types" DROP COLUMN "functionId",
ADD COLUMN     "eventId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "function_ticket_types" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priceOverride" DECIMAL(10,2),
    "quantityOverride" INTEGER,
    "visibleOverride" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "functionId" TEXT NOT NULL,
    "ticketTypeId" TEXT NOT NULL,

    CONSTRAINT "function_ticket_types_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "function_ticket_types_functionId_ticketTypeId_key" ON "function_ticket_types"("functionId", "ticketTypeId");

-- AddForeignKey
ALTER TABLE "ticket_types" ADD CONSTRAINT "ticket_types_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "function_ticket_types" ADD CONSTRAINT "function_ticket_types_functionId_fkey" FOREIGN KEY ("functionId") REFERENCES "event_functions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "function_ticket_types" ADD CONSTRAINT "function_ticket_types_ticketTypeId_fkey" FOREIGN KEY ("ticketTypeId") REFERENCES "ticket_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;
