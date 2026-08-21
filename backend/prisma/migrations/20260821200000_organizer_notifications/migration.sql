-- Notificaciones Organizer — preferencias configurables por organización.
-- Fila opcional: no se siembra una por cada organización existente (ver el
-- comentario del modelo en schema.prisma) — el código trata "sin fila" como
-- "todo apagado", que ya es el default seguro pedido para organizaciones
-- existentes.
--
-- "Organization" (no "organizations"): ese modelo no tiene @@map, su tabla
-- real es el nombre PascalCase tal cual — ver el comentario ya dejado en
-- 20260820120000_service_fee_tiers/migration.sql sobre el P3018 real que
-- causó escribir esto mal una vez.
CREATE TABLE "organizer_notification_settings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "saleConfirmedEnabled" BOOLEAN NOT NULL DEFAULT false,
    "salesMilestoneEnabled" BOOLEAN NOT NULL DEFAULT false,
    "salesMilestoneCount" INTEGER NOT NULL DEFAULT 100,
    "lowStockEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lowStockPercent" INTEGER NOT NULL DEFAULT 20,
    "eventReminderEnabled" BOOLEAN NOT NULL DEFAULT false,
    "eventReminderHoursBefore" INTEGER NOT NULL DEFAULT 24,
    "eventStartEnabled" BOOLEAN NOT NULL DEFAULT false,
    "eventEndEnabled" BOOLEAN NOT NULL DEFAULT false,
    "scannerActivityEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizer_notification_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organizer_notification_settings_organizationId_key" ON "organizer_notification_settings"("organizationId");

ALTER TABLE "organizer_notification_settings" ADD CONSTRAINT "organizer_notification_settings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Ledger genérico de deduplicación "reclamado una única vez" (nunca una
-- ventana de tiempo — ver el comentario del modelo en schema.prisma sobre
-- por qué esto NO reutiliza developer_alert_cooldowns). Un `create()` que
-- choca contra el @unique de `key` es la señal atómica de "ya reclamado".
CREATE TABLE "organizer_notification_claims" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizer_notification_claims_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organizer_notification_claims_key_key" ON "organizer_notification_claims"("key");
