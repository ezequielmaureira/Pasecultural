-- CreateTable: Modo Prelanzamiento — fila única ("singleton"), mismo
-- criterio que developer_alert_config. Controla si la superficie pública
-- de PaseCultural (marketplace de eventos, compra, recuperación) está
-- accesible para un visitante anónimo mientras terminamos Premium,
-- pruebas, revisión legal/fiscal y preparación del lanzamiento. Editable
-- exclusivamente por DEVELOPER (ver publicLaunchSettings.routes.js).
-- Temporal a propósito: no es el futuro modo mantenimiento real.
--
-- Sembrada en `false` (prelanzamiento activo) directamente acá, a
-- diferencia de developer_alert_config: este flag es de seguridad, no
-- informativo, así que tiene que quedar operativo desde el primer deploy
-- sin depender de que un DEVELOPER la guarde primero desde el panel.
CREATE TABLE "public_launch_settings" (
    "id" TEXT NOT NULL,
    "publicLaunchEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT,

    CONSTRAINT "public_launch_settings_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "public_launch_settings" ADD CONSTRAINT "public_launch_settings_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "public_launch_settings_updatedByUserId_idx" ON "public_launch_settings"("updatedByUserId");

-- Seed inicial — publicLaunchEnabled=false, updatedByUserId NULL: esta
-- fila no la guardó ningún DEVELOPER real.
INSERT INTO "public_launch_settings" (
    "id", "publicLaunchEnabled", "createdAt", "updatedAt", "updatedByUserId"
) VALUES (
    'publiclaunch_seed_1', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
);
