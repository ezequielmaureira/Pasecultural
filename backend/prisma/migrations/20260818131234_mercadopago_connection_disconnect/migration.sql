-- CreateEnum
CREATE TYPE "MercadoPagoConnectionStatus" AS ENUM ('ACTIVE', 'DISCONNECTED');

-- DropIndex
DROP INDEX "mercado_pago_connections_organizationId_key";

-- AlterTable
ALTER TABLE "mercado_pago_connections" ADD COLUMN     "disconnectedAt" TIMESTAMP(3),
ADD COLUMN     "status" "MercadoPagoConnectionStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateIndex
CREATE INDEX "mercado_pago_connections_organizationId_idx" ON "mercado_pago_connections"("organizationId");

-- CreateIndex
CREATE INDEX "mercado_pago_connections_mercadoPagoUserId_idx" ON "mercado_pago_connections"("mercadoPagoUserId");
