-- Autoservicio "Eliminar organización" (Organizador → Configuración → Zona
-- de peligro) — soft delete: la Organization y todo su historial se
-- conservan, sólo se marca closedAt. Columna nullable, sin default ni
-- backfill: todas las organizaciones existentes quedan con closedAt NULL
-- (activas), exactamente como estaban.

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "closedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Organization_ownerId_closedAt_idx" ON "Organization"("ownerId", "closedAt");
