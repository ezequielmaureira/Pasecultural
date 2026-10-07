-- "Eliminar organización" por su propietario pasa de soft delete
-- (closedAt + SUSPENDED) a hard delete real con antecedente histórico.
--
-- Migración NO destructiva:
--   * Tabla nueva deleted_organizations (vacía).
--   * Event.organizationId y withdrawal_requests.organizationId pasan a
--     nullable. Ninguna fila existente cambia (sin backfill): todas siguen
--     con su organizationId actual.
--   * Columnas nuevas deletedOrganizationId (nullable, sin default).
--   * Las FK existentes hacia "Organization" NO se tocan: siguen siendo
--     ON DELETE RESTRICT, así que un DELETE de Organization a ciegas sigue
--     fallando si quedan eventos/solicitudes colgando. Sólo
--     organizationDeletion.service.js desacopla explícitamente antes.
--   * Las FK nuevas hacia deleted_organizations también son RESTRICT.
--
-- La conversión de las organizaciones cerradas con el mecanismo viejo NO
-- se hace acá: es un script aparte (scripts/convertClosedOrganizations.js)
-- que requiere confirmación explícita.

-- CreateEnum
CREATE TYPE "OrganizationDeletionReason" AS ENUM ('DELETED_BY_USER');

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "deletedOrganizationId" TEXT,
ALTER COLUMN "organizationId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "withdrawal_requests" ADD COLUMN     "deletedOrganizationId" TEXT,
ALTER COLUMN "organizationId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "deleted_organizations" (
    "id" TEXT NOT NULL,
    "originalOrganizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logo" TEXT,
    "email" TEXT NOT NULL,
    "plan" "OrganizationPlan" NOT NULL,
    "type" "OrganizationType",
    "city" TEXT,
    "province" TEXT,
    "responsibleFirstName" TEXT,
    "responsibleLastName" TEXT,
    "ownerId" TEXT,
    "ownerFirstName" TEXT,
    "ownerLastName" TEXT,
    "ownerEmail" TEXT,
    "originalStatus" "OrganizationStatus" NOT NULL,
    "originalCreatedAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" "OrganizationDeletionReason" NOT NULL,

    CONSTRAINT "deleted_organizations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "deleted_organizations_originalOrganizationId_key" ON "deleted_organizations"("originalOrganizationId");

-- CreateIndex
CREATE INDEX "deleted_organizations_ownerId_idx" ON "deleted_organizations"("ownerId");

-- CreateIndex
CREATE INDEX "deleted_organizations_originalCreatedAt_idx" ON "deleted_organizations"("originalCreatedAt");

-- AddForeignKey
ALTER TABLE "deleted_organizations" ADD CONSTRAINT "deleted_organizations_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_deletedOrganizationId_fkey" FOREIGN KEY ("deletedOrganizationId") REFERENCES "deleted_organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_deletedOrganizationId_fkey" FOREIGN KEY ("deletedOrganizationId") REFERENCES "deleted_organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

