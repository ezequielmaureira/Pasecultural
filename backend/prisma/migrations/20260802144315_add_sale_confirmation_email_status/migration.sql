-- CreateEnum
CREATE TYPE "EmailDeliveryStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED');

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "confirmationEmailAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "confirmationEmailLastAttemptAt" TIMESTAMP(3),
ADD COLUMN     "confirmationEmailLastError" TEXT,
ADD COLUMN     "confirmationEmailProviderId" TEXT,
ADD COLUMN     "confirmationEmailSentAt" TIMESTAMP(3),
ADD COLUMN     "confirmationEmailStatus" "EmailDeliveryStatus" NOT NULL DEFAULT 'PENDING';
