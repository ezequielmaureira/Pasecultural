-- AlterTable
ALTER TABLE "event_scanners" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "sale_recovery_verifications" (
    "id" TEXT NOT NULL,
    "normalizedEmail" TEXT NOT NULL,
    "normalizedDocument" TEXT NOT NULL,
    "codeHash" TEXT,
    "codeExpiresAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sale_recovery_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sale_recovery_verifications_normalizedEmail_normalizedDocum_key" ON "sale_recovery_verifications"("normalizedEmail", "normalizedDocument");
