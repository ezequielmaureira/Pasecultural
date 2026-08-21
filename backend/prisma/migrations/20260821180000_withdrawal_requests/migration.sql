-- CreateEnum
CREATE TYPE "WithdrawalRequestReason" AS ENUM ('ARREPENTIMIENTO', 'ERROR_COMPRA', 'CAMBIO_EVENTO', 'PROBLEMA_ENTRADAS', 'OTRO');

-- CreateEnum
CREATE TYPE "WithdrawalRequestStatus" AS ENUM ('REQUESTED', 'CONTACTED', 'RESOLVED');

-- CreateTable: Botón de arrepentimiento — segundo factor (código de 6
-- dígitos), estructura idéntica a sale_recovery_verifications pero en su
-- propia tabla: comparten el mismo par (email, DNI) como clave, así que
-- reusar esa tabla haría que iniciar este flujo invalidara silenciosamente
-- un código de "Recuperar mis entradas" en curso para la misma persona (y
-- viceversa) — ver el comentario del modelo en schema.prisma.
CREATE TABLE "withdrawal_request_verifications" (
    "id" TEXT NOT NULL,
    "normalizedEmail" TEXT NOT NULL,
    "normalizedDocument" TEXT NOT NULL,
    "codeHash" TEXT,
    "codeExpiresAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "withdrawal_request_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "withdrawal_request_verifications_normalizedEmail_normalize_key" ON "withdrawal_request_verifications"("normalizedEmail", "normalizedDocument");

-- CreateTable: Botón de arrepentimiento — la solicitud en sí. Nunca
-- modifica Sale/Ticket, nunca dispara ningún reembolso — ver el comentario
-- del modelo en schema.prisma.
CREATE TABLE "withdrawal_requests" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" "WithdrawalRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" "WithdrawalRequestReason",
    "reasonNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "withdrawal_requests_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
-- "sales" está mapeado (@@map), "Event"/"Organization"/"User" NO tienen
-- @@map (su tabla real es el nombre del modelo tal cual, PascalCase) — ver
-- el comentario ya dejado en 20260820120000_service_fee_tiers/migration.sql
-- sobre el P3018 real que causó escribir esto mal una vez.
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "withdrawal_requests_organizationId_createdAt_idx" ON "withdrawal_requests"("organizationId", "createdAt");
CREATE INDEX "withdrawal_requests_saleId_idx" ON "withdrawal_requests"("saleId");

-- CreateIndex (índice único PARCIAL — Prisma no expresa esto en el schema,
-- se mantiene tal cual en cada `prisma migrate diff`/reset futuro porque
-- vive en el historial de migraciones, no en schema.prisma)
-- Concurrent-safe a nivel Postgres: a lo sumo UNA fila con status en
-- ('REQUESTED','CONTACTED') por saleId — un segundo INSERT que violaría
-- esto falla con 23505 (unique_violation), nunca crea una fila duplicada
-- aunque dos requests concurrentes intenten registrar la misma solicitud
-- al mismo tiempo. Después de RESOLVED, nada impide una solicitud nueva
-- (no está en la condición del índice).
CREATE UNIQUE INDEX "withdrawal_requests_active_per_sale" ON "withdrawal_requests"("saleId") WHERE "status" IN ('REQUESTED', 'CONTACTED');

-- AlterTable: Alertas Developer — WITHDRAWAL_REQUESTS_VOLUME_SPIKE.
-- DEFAULT en el ALTER cubre la fila singleton ya sembrada por
-- 20260821140000_developer_alerts sin dejarla en un estado inconsistente.
ALTER TABLE "developer_alert_config" ADD COLUMN "withdrawalRequestsWindowCount" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN "withdrawalRequestsWindowHours" INTEGER NOT NULL DEFAULT 24;
