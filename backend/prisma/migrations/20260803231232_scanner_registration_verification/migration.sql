-- Elimina PENDING del enum: Postgres no permite DROP VALUE directo, así que
-- se recrea el tipo sin ese valor y se migra la columna (mismo patrón que
-- genera `prisma migrate dev` para este caso). Verificado antes de escribir
-- esta migración: event_scanners no tiene ninguna fila en PENDING (0 filas
-- en producción con ese valor), así que el USING cast no pierde datos.
BEGIN;

CREATE TYPE "EventScannerStatus_new" AS ENUM ('INVITED', 'ACTIVE', 'DISABLED', 'REVOKED');
ALTER TABLE "event_scanners" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "event_scanners" ALTER COLUMN "status" TYPE "EventScannerStatus_new" USING ("status"::text::"EventScannerStatus_new");
ALTER TYPE "EventScannerStatus" RENAME TO "EventScannerStatus_old";
ALTER TYPE "EventScannerStatus_new" RENAME TO "EventScannerStatus";
DROP TYPE "EventScannerStatus_old";
ALTER TABLE "event_scanners" ALTER COLUMN "status" SET DEFAULT 'INVITED';

COMMIT;

-- AlterTable
ALTER TABLE "event_scanners"
  DROP COLUMN "approvedBy",
  DROP COLUMN "approvedAt",
  ADD COLUMN "firstName" TEXT,
  ADD COLUMN "lastName" TEXT,
  ADD COLUMN "document" TEXT,
  ADD COLUMN "email" TEXT,
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "verificationCodeHash" TEXT,
  ADD COLUMN "verificationCodeExpiresAt" TIMESTAMP(3),
  ADD COLUMN "verificationAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "verificationLastSentAt" TIMESTAMP(3),
  ADD COLUMN "activatedAt" TIMESTAMP(3);
