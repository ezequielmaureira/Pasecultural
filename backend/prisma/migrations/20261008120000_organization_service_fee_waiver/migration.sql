-- Beneficio para compradores: cargo de servicio Smarticket $0 durante una
-- cantidad configurable de meses desde la primera publicación de la
-- organización (renovable a mano desde Developer).
--
-- 1) Organization: dos columnas nullable, sin default. Ninguna fila
--    existente cambia de comportamiento hasta correr el backfill
--    (scripts/backfillServiceFeeWaiver.js, dry-run por defecto).
ALTER TABLE "Organization" ADD COLUMN "firstEventPublishedAt" TIMESTAMP(3);
ALTER TABLE "Organization" ADD COLUMN "serviceFeeWaivedUntil" TIMESTAMP(3);

-- 2) service_fee_settings: fila única, editable desde Developer >
--    Configuración. Sembrada con 1 mes para que la regla quede operativa
--    desde el primer deploy sin depender de que alguien la guarde.
CREATE TABLE "service_fee_settings" (
    "id" TEXT NOT NULL,
    "serviceFeeWaiverDurationMonths" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT,

    CONSTRAINT "service_fee_settings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "service_fee_settings_updatedByUserId_idx" ON "service_fee_settings"("updatedByUserId");

ALTER TABLE "service_fee_settings" ADD CONSTRAINT "service_fee_settings_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "service_fee_settings" ("id", "serviceFeeWaiverDurationMonths", "updatedAt")
VALUES ('servicefeesettings_seed_1', 1, CURRENT_TIMESTAMP);
