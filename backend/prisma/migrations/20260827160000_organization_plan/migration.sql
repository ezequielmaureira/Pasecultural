-- Premium — Fase 1 (infraestructura + administración manual, ver el
-- informe de auditoría/entrega). Activación exclusivamente manual por
-- DEVELOPER (nunca autoservicio del Organizer) — todavía NO gobierna
-- ninguna restricción ni beneficio funcional, sólo se persiste y se
-- muestra.
--
-- Aditiva y compatible hacia atrás: DEFAULT 'FREE' hace que todas las
-- organizaciones existentes queden exactamente igual que antes de esta
-- migración, sin backfill — mismo criterio ya usado para
-- events.admissionType/tickets.origin/sales.origin/public_launch_settings.
CREATE TYPE "OrganizationPlan" AS ENUM ('FREE', 'PREMIUM');

ALTER TABLE "Organization" ADD COLUMN "plan" "OrganizationPlan" NOT NULL DEFAULT 'FREE';
ALTER TABLE "Organization" ADD COLUMN "planUpdatedAt" TIMESTAMP(3);
ALTER TABLE "Organization" ADD COLUMN "planUpdatedByUserId" TEXT;

-- AddForeignKey
-- Nombre de constraint derivado del campo escalar ("planUpdatedByUserId"),
-- nunca del nombre de relación de Prisma ("OrganizationPlanUpdatedBy") —
-- el @relation nombrado en schema.prisma es sólo para desambiguar la
-- segunda relación Organization->User del lado del cliente (frente a
-- owner/ownerId, ya existente): no requiere tocar ni renombrar la FK
-- "Organization_ownerId_fkey" que ya existe.
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_planUpdatedByUserId_fkey" FOREIGN KEY ("planUpdatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "Organization_planUpdatedByUserId_idx" ON "Organization"("planUpdatedByUserId");
