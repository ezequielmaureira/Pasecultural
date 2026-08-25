-- Ronda "recuperación de pagos" (parte 2) — "Pagué pero no recibí mis
-- entradas". ALTER TYPE ... ADD VALUE es seguro dentro de esta migración
-- porque el valor nuevo no se usa en la misma transacción — sólo se agrega
-- (mismo criterio ya usado en 20260822120000_withdrawal_request_dismissed_status).
ALTER TYPE "MercadoPagoConfirmationSource" ADD VALUE 'BUYER_RECOVERY';

-- CreateTable
CREATE TABLE "sale_payment_recovery_verifications" (
    "id" TEXT NOT NULL,
    "normalizedEmail" TEXT NOT NULL,
    "normalizedDocument" TEXT NOT NULL,
    "codeHash" TEXT,
    "codeExpiresAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sale_payment_recovery_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sale_payment_recovery_verifications_normalizedEmail_normal_key" ON "sale_payment_recovery_verifications"("normalizedEmail", "normalizedDocument");
