/*
  Warnings:

  - You are about to drop the column `secretHash` on the `ticket_qrs` table. All the data in the column will be lost.
  - Added the required column `secretEncrypted` to the `ticket_qrs` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ticket_qrs" DROP COLUMN "secretHash",
ADD COLUMN     "secretEncrypted" TEXT NOT NULL;
