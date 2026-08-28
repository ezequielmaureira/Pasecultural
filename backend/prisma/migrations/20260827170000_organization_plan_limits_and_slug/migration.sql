-- Premium — Fase 2A: infraestructura base (ver el informe de auditoría/
-- entrega). Agrega:
--   1) Organization.slug — identificador público estable, independiente
--      del plan (FREE también lo tiene) y del nombre (nunca se regenera
--      solo). Backfill collision-safe para las Organizations existentes
--      ANTES de aplicar NOT NULL/UNIQUE — nunca "ADD COLUMN ... NOT NULL
--      UNIQUE" directo sobre una tabla que ya tiene filas.
--   2) Organization.brandPrimaryColor — color de marca validado
--      (#RRGGBB) para la futura página pública Premium. Nullable: ninguna
--      Organization lo tiene todavía, y el endpoint que lo escribiría
--      queda para una fase posterior (ver el informe de entrega).
--   3) organization_plan_limits — configuración GENERAL (una fila por
--      OrganizationPlan, nunca por Organization) de los 3 límites de la
--      futura Fase 2D, editable por DEVELOPER sin redeploy. Sembrada con
--      FREE/PREMIUM en null (sin límite) — la infraestructura nace sin
--      bloquear nada; el repo no contiene ningún número de negocio
--      oficial documentado para eventos activos/cortesías/scanners.

-- AlterTable: columnas nuevas, NULLABLE primero (Organization ya tiene
-- filas).
ALTER TABLE "Organization" ADD COLUMN "slug" TEXT;
ALTER TABLE "Organization" ADD COLUMN "brandPrimaryColor" TEXT;

-- Backfill de slug para Organizations existentes. Normalización
-- simplificada vía translate() de diacríticos latinos comunes —
-- DISTINTA, a propósito, de slugify() (utils/generateSlug.js,
-- normalize("NFD") + regex Unicode) que es la que usa
-- createOrganizationService para cada Organization NUEVA de acá en más.
-- Acá sólo hace falta un backfill único, determinístico y razonable en
-- SQL puro — no la normalización Unicode completa, que no está disponible
-- como función nativa de Postgres sin la extensión unaccent (no
-- instalada). Colisiones resueltas con sufijo numérico incremental
-- ("-2", "-3", ...), visible dentro de la misma transacción para las
-- filas ya actualizadas en este mismo loop (MVCC: un UPDATE es visible a
-- los SELECT siguientes de la misma transacción).
DO $$
DECLARE
    org RECORD;
    base_slug TEXT;
    candidate_slug TEXT;
    suffix INT;
BEGIN
    FOR org IN SELECT id, name FROM "Organization" WHERE slug IS NULL ORDER BY "createdAt" ASC LOOP
        base_slug := lower(org.name);
        base_slug := translate(base_slug, 'áéíóúüñàèìòùâêîôûäëïö', 'aeiouunaeiouaeiouaeio');
        base_slug := regexp_replace(base_slug, '[^a-z0-9]+', '-', 'g');
        base_slug := regexp_replace(base_slug, '(^-+|-+$)', '', 'g');
        IF base_slug IS NULL OR base_slug = '' THEN
            base_slug := 'organizacion';
        END IF;

        candidate_slug := base_slug;
        suffix := 1;
        WHILE EXISTS (SELECT 1 FROM "Organization" WHERE slug = candidate_slug) LOOP
            suffix := suffix + 1;
            candidate_slug := base_slug || '-' || suffix;
        END LOOP;

        UPDATE "Organization" SET slug = candidate_slug WHERE id = org.id;
    END LOOP;
END $$;

-- Recién ahora, con TODAS las filas ya pobladas y sin colisiones, la
-- constraint definitiva — mismo criterio que Event.slug.
ALTER TABLE "Organization" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateTable
CREATE TABLE "organization_plan_limits" (
    "id" TEXT NOT NULL,
    "plan" "OrganizationPlan" NOT NULL,
    "maxActiveEvents" INTEGER,
    "maxCourtesiesPerEvent" INTEGER,
    "maxScannersPerEvent" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT,

    CONSTRAINT "organization_plan_limits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organization_plan_limits_plan_key" ON "organization_plan_limits"("plan");

-- CreateIndex
CREATE INDEX "organization_plan_limits_updatedByUserId_idx" ON "organization_plan_limits"("updatedByUserId");

-- AddForeignKey
ALTER TABLE "organization_plan_limits" ADD CONSTRAINT "organization_plan_limits_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Bootstrap: filas iniciales FREE/PREMIUM, ambas en null (sin límite) —
-- ver el informe de entrega, sección "valores iniciales". updatedByUserId
-- queda NULL: estas 2 filas no las guardó ningún DEVELOPER real, nacen
-- con el deploy — mismo criterio que service_fee_tiers/public_launch_settings.
INSERT INTO "organization_plan_limits" ("id", "plan", "maxActiveEvents", "maxCourtesiesPerEvent", "maxScannersPerEvent", "createdAt", "updatedAt", "updatedByUserId")
VALUES
    ('planlimits_seed_free', 'FREE', NULL, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL),
    ('planlimits_seed_premium', 'PREMIUM', NULL, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL);
