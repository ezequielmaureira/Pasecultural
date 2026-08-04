-- EventScanner deja de depender de User/Clerk por completo: la identidad
-- del scanner pasa a ser únicamente su propio registro (nombre/apellido/
-- DNI/email/teléfono) + un scannerSessionToken (JWT) emitido al verificar
-- el código. Se cambia el candado anti-duplicado de (eventId, userId) a
-- (eventId, email) — mismo propósito (no dos altas activas de la misma
-- persona para el mismo evento), sin necesitar una cuenta.

-- DropForeignKey
ALTER TABLE "event_scanners" DROP CONSTRAINT "event_scanners_userId_fkey";

-- DropIndex
DROP INDEX "event_scanners_eventId_userId_key";

-- AlterTable
ALTER TABLE "event_scanners" DROP COLUMN "userId";

-- CreateIndex
CREATE UNIQUE INDEX "event_scanners_eventId_email_key" ON "event_scanners"("eventId", "email");
