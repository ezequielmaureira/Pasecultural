-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "mercadoPagoPaymentId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "sales_mercadoPagoPaymentId_key" ON "sales"("mercadoPagoPaymentId");
