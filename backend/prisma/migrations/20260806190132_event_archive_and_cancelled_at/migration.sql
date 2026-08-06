-- AlterTable
-- Ambas nullable, sin backfill: todos los eventos existentes quedan
-- cancelledAt=null/archivedAt=null (ninguno "cancelado ahora mismo" ni
-- archivado por esta migración) — correcto, nadie pierde estado real.
ALTER TABLE "Event" ADD COLUMN "cancelledAt" TIMESTAMP(3);
ALTER TABLE "Event" ADD COLUMN "archivedAt" TIMESTAMP(3);
