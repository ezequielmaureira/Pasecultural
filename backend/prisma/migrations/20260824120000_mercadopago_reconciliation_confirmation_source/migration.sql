-- CreateEnum
CREATE TYPE "MercadoPagoConfirmationSource" AS ENUM ('WEBHOOK', 'RECONCILIATION_AUTO', 'RECONCILIATION_MANUAL');

-- AlterTable
ALTER TABLE "sales" ADD COLUMN "confirmationSource" "MercadoPagoConfirmationSource";
