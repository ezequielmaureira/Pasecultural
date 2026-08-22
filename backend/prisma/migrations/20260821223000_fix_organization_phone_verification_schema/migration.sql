-- Corrige la migración 20260821220000_organization_phone_verification, que
-- YA fue aplicada en producción (y posiblemente en otras bases) con su
-- versión ANTERIOR al cambio de diseño de flujo invertido (commit
-- f6a8ce8): Prisma identifica las migraciones por NOMBRE de carpeta, así
-- que "prisma migrate deploy" nunca vuelve a ejecutar el SQL de una
-- migración ya registrada como aplicada, aunque su archivo haya cambiado
-- desde entonces — la base quedó con "lastSentAt" y sin
-- "challengeTokenHash" mientras el código (organizationPhoneVerification.service.js)
-- ya escribe/lee "lastIssuedAt" y "challengeTokenHash", produciendo el
-- error real de producción:
--   "The column `organization_phone_verifications.lastIssuedAt` does not
--   exist in the current database."
--
-- REGLA: 20260821220000 queda INMUTABLE desde acá en más — esta es una
-- migración forward-only nueva, nunca una edición retroactiva.
--
-- Alcance verificado (git diff 1760f1b..f6a8ce8 sobre esa migración): el
-- ÚNICO bloque que cambió fue la tabla "organization_phone_verifications"
-- (columna renombrada + columna nueva + índice único nuevo).
-- "organization_phone_change_authorizations" y la columna
-- "Organization"."phoneVerifiedAt" NO cambiaron entre esas dos versiones —
-- no requieren ningún ajuste acá.
--
-- Preservación de datos: NUNCA se recrea/dropea la tabla. Se renombra la
-- columna real (RENAME COLUMN, conserva cada valor existente tal cual) y
-- se agrega la columna nueva de forma compatible con filas ya existentes
-- (si las hay: sólo pudieron haberse creado bajo el diseño ANTERIOR, que
-- mandaba un template de WhatsApp — nunca tuvieron ni pudieron tener un
-- token real, ese concepto no existía todavía). A esas filas preexistentes
-- se les asigna un placeholder ÚNICO derivado de su propio "id" (md5, 32
-- hex) — nunca puede coincidir con un hash SHA-256 real (64 hex, ver
-- utils/organizationPhoneChallengeToken.js), así que quedan inertes de
-- forma criptográfica además de por expiración: ningún "CONFIRMAR <token>"
-- real puede derivar ese valor. Se las expira también (expiresAt <= ahora)
-- para que el estado que ve el organizador en el Dashboard (GET
-- .../phone-verification) dejen de mostrarse como "pendiente" — un
-- challenge que ya nunca puede confirmarse no debe aparecer como si
-- pudiera. Cero filas borradas.

ALTER TABLE "organization_phone_verifications" RENAME COLUMN "lastSentAt" TO "lastIssuedAt";

ALTER TABLE "organization_phone_verifications" ADD COLUMN IF NOT EXISTS "challengeTokenHash" TEXT;

UPDATE "organization_phone_verifications"
SET "challengeTokenHash" = md5("id"),
    "expiresAt" = LEAST("expiresAt", now())
WHERE "challengeTokenHash" IS NULL;

ALTER TABLE "organization_phone_verifications" ALTER COLUMN "challengeTokenHash" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "organization_phone_verifications_challengeTokenHash_key" ON "organization_phone_verifications"("challengeTokenHash");
