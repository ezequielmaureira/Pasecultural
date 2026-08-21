-- CreateTable: Alertas Developer — configuración de umbrales (fila única /
-- "singleton"), editable exclusivamente por DEVELOPER (ver
-- developerAlertConfig.routes.js). Reemplaza cualquier número mágico
-- disperso por services — un único lugar de verdad, mismo criterio que
-- ServiceFeeTier.
CREATE TABLE "developer_alert_config" (
    "id" TEXT NOT NULL,
    "highTicketPriceThreshold" DECIMAL(10,2) NOT NULL,
    "highSaleQuantityThreshold" INTEGER NOT NULL,
    "eventsWindowCount" INTEGER NOT NULL,
    "eventsWindowHours" INTEGER NOT NULL,
    "salesVolumeWindowCount" INTEGER NOT NULL,
    "salesVolumeWindowMinutes" INTEGER NOT NULL,
    "refundsVolumeWindowCount" INTEGER NOT NULL,
    "refundsVolumeWindowHours" INTEGER NOT NULL,
    "alertCooldownMinutes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT,

    CONSTRAINT "developer_alert_config_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
-- Prisma no genera "users" acá: el modelo User no tiene @@map, así que su
-- tabla real es "User" (PascalCase, tal cual el nombre del modelo) — mismo
-- punto que ya causó un P3018 real en 20260820120000_service_fee_tiers,
-- corregido ahí; acá se escribe bien desde el principio.
ALTER TABLE "developer_alert_config" ADD CONSTRAINT "developer_alert_config_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "developer_alert_config_updatedByUserId_idx" ON "developer_alert_config"("updatedByUserId");

-- Seed inicial — umbrales de partida razonables (ver informe de entrega,
-- sección "Umbrales iniciales"), operativos desde el primer deploy sin
-- depender de que un DEVELOPER real los guarde primero desde el panel.
-- updatedByUserId queda NULL: esta fila no la guardó ningún DEVELOPER real.
INSERT INTO "developer_alert_config" (
    "id", "highTicketPriceThreshold", "highSaleQuantityThreshold",
    "eventsWindowCount", "eventsWindowHours",
    "salesVolumeWindowCount", "salesVolumeWindowMinutes",
    "refundsVolumeWindowCount", "refundsVolumeWindowHours",
    "alertCooldownMinutes", "createdAt", "updatedAt", "updatedByUserId"
) VALUES (
    'devalertcfg_seed_1', 500000.00, 50,
    10, 24,
    100, 60,
    10, 24,
    60, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
);

-- CreateTable: Alertas Developer — deduplicación/cooldown PERSISTENTE de
-- las alertas repetibles por umbral (2A/2C/2D/2E). Nunca en memoria del
-- proceso Node: Render puede reiniciar o correr más de una instancia (ver
-- informe de entrega, sección "Deduplicación y cooldown"). `key` identifica
-- de forma estable qué se está limitando (tipo de alerta + alcance, ej.
-- "sales-volume:{organizationId}"); el "claim" atómico de cooldown es un
-- UPDATE condicional sobre `lastFiredAt` (ver
-- sendDeveloperAlert.service.js#tryClaimDeveloperAlertCooldown), nunca un
-- lock explícito.
CREATE TABLE "developer_alert_cooldowns" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "lastFiredAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "developer_alert_cooldowns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "developer_alert_cooldowns_key_key" ON "developer_alert_cooldowns"("key");

-- CreateTable: Alertas Developer — 2E (refunds anormalmente frecuentes).
-- Registro mínimo, sólo-append, de cada reversión (refunded/charged_back)
-- procesada por el webhook: ni Sale ni Ticket tienen ningún campo de
-- timestamp que indique CUÁNDO ocurrió una reversión (Ticket no tiene
-- updatedAt), así que no se puede calcular volumen por ventana de tiempo
-- con los datos existentes — ver el informe de entrega. Sin foreign keys a
-- propósito: es un log interno, nunca una entidad de negocio, y nunca debe
-- poder bloquear ni fallar por una FK mientras el webhook ya está
-- respondiéndole a Mercado Pago.
CREATE TABLE "developer_alert_reversal_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "developer_alert_reversal_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "developer_alert_reversal_events_organizationId_occurredAt_idx" ON "developer_alert_reversal_events"("organizationId", "occurredAt");
