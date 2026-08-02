-- AlterTable
ALTER TABLE "sales" ADD COLUMN "publicRecoveryToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "sales_publicRecoveryToken_key" ON "sales"("publicRecoveryToken");
