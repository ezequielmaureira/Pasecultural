-- Verificación de teléfono/WhatsApp de Organización.
--
-- CRÍTICO (compatibilidad): ya existen organizaciones en producción con
-- Organization.phone poblado. Esta columna nueva es NULLABLE sin DEFAULT
-- distinto de NULL — toda fila existente queda con phoneVerifiedAt = NULL,
-- es decir "no verificado", nunca marcado VERIFIED automáticamente sólo
-- porque ya tenían un valor de texto libre ahí. El botón de contacto
-- (WithdrawalRequest) cae a email para esas organizaciones hasta que
-- verifiquen su número por este mecanismo — comportamiento explícito, no
-- un olvido (ver el informe de entrega).
ALTER TABLE "Organization" ADD COLUMN "phoneVerifiedAt" TIMESTAMP(3);

-- "Organization"/"User" (no "organizations"/"users"): esos modelos no
-- tienen @@map, su tabla real es el nombre PascalCase tal cual — ver el
-- comentario ya dejado en 20260820120000_service_fee_tiers/migration.sql
-- sobre el P3018 real que causó escribir esto mal una vez.
CREATE TABLE "organization_phone_change_authorizations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "newPhone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSentAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_phone_change_authorizations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organization_phone_change_authorizations_organizationId_key" ON "organization_phone_change_authorizations"("organizationId");

ALTER TABLE "organization_phone_change_authorizations" ADD CONSTRAINT "organization_phone_change_authorizations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "organization_phone_change_authorizations" ADD CONSTRAINT "organization_phone_change_authorizations_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "organization_phone_verifications" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "pendingPhone" TEXT NOT NULL,
    "pendingWaId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSentAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_phone_verifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organization_phone_verifications_organizationId_key" ON "organization_phone_verifications"("organizationId");
-- No único: dos organizaciones distintas pueden estar verificando el
-- mismo wa_id de buena fe al mismo tiempo (ver el comentario del modelo).
CREATE INDEX "organization_phone_verifications_pendingWaId_idx" ON "organization_phone_verifications"("pendingWaId");

ALTER TABLE "organization_phone_verifications" ADD CONSTRAINT "organization_phone_verifications_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "organization_phone_verifications" ADD CONSTRAINT "organization_phone_verifications_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
