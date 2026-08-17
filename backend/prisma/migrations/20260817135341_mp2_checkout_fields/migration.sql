-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "checkoutIdempotencyKey" TEXT,
ADD COLUMN     "mercadoPagoInitPoint" TEXT,
ADD COLUMN     "mercadoPagoPreferenceId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "sales_checkoutIdempotencyKey_key" ON "sales"("checkoutIdempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "sales_mercadoPagoPreferenceId_key" ON "sales"("mercadoPagoPreferenceId");
