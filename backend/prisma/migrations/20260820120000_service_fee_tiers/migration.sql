-- AlterTable: snapshot inmutable de comisión de servicio en Sale.
-- Nullable a propósito: no es un backfill retroactivo, sólo aplica desde
-- ahora en adelante para paymentMethod=MERCADO_PAGO (ver
-- createSaleForBuyer, sale.service.js). Ventas MANUAL/Courtesy y filas
-- históricas de Mercado Pago quedan con NULL para siempre.
ALTER TABLE "sales" ADD COLUMN     "ticketsSubtotal" DECIMAL(10,2),
ADD COLUMN     "serviceFee" DECIMAL(10,2);

-- AlterTable: mismo criterio, a nivel de cada tipo de entrada dentro de la
-- venta.
ALTER TABLE "sale_items" ADD COLUMN     "serviceFeeUnit" DECIMAL(10,2),
ADD COLUMN     "serviceFeeSubtotal" DECIMAL(10,2);

-- CreateTable: configuración autoritativa server-side de la comisión de
-- servicio, editable exclusivamente por DEVELOPER (ver
-- developerServiceFee.routes.js). Reemplaza al PLATFORM_FEE_PERCENTAGE
-- fijo del 10% (eliminado del código en este mismo cambio).
CREATE TABLE "service_fee_tiers" (
    "id" TEXT NOT NULL,
    "minAmount" DECIMAL(10,2) NOT NULL,
    "maxAmount" DECIMAL(10,2),
    "feeAmount" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT,

    CONSTRAINT "service_fee_tiers_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "service_fee_tiers" ADD CONSTRAINT "service_fee_tiers_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "service_fee_tiers_updatedByUserId_idx" ON "service_fee_tiers"("updatedByUserId");

-- Reglas iniciales de comisión — insertadas directamente acá para que
-- estén operativas de inmediato apenas se aplica esta migración, sin
-- depender de correr un seed manual en producción (ver auditoría de
-- comisión de servicio). updatedByUserId queda NULL: estas 4 filas no las
-- guardó ningún DEVELOPER real desde el panel, nacen con el deploy.
--
-- [$0, $5.000)   -> $150 por entrada
-- [$5.000, $10.000)  -> $500 por entrada
-- [$10.000, $50.000) -> $1.000 por entrada
-- [$50.000, sin límite) -> $2.000 por entrada
--
-- El precio exactamente $0 nunca consulta esta tabla — está hardcodeado
-- en calculateServiceFeeForUnitPrice (comisión $0 siempre), así que no
-- hace falta (ni corresponde) una fila acá para el caso gratuito.
INSERT INTO "service_fee_tiers" ("id", "minAmount", "maxAmount", "feeAmount", "createdAt", "updatedAt", "updatedByUserId") VALUES
    ('svcfeetier_seed_1', 0.00, 5000.00, 150.00, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL),
    ('svcfeetier_seed_2', 5000.00, 10000.00, 500.00, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL),
    ('svcfeetier_seed_3', 10000.00, 50000.00, 1000.00, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL),
    ('svcfeetier_seed_4', 50000.00, NULL, 2000.00, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL);
