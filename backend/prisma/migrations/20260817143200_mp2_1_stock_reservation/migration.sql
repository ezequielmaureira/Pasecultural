-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "mercadoPagoExternalReference" TEXT,
ADD COLUMN     "stockReservedUntil" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "sales_mercadoPagoExternalReference_key" ON "sales"("mercadoPagoExternalReference");
