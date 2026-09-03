-- Rubro de contenido de la organización (Organizaciones Destacadas —
-- filtro público de /organizaciones). Deliberadamente separado de
-- OrganizationType (tipo de entidad legal/organizativa): este campo nuevo
-- describe qué programa la organización de cara al público (teatro, cine,
-- música, deportes, cultura, productora, otro), no qué tipo de entidad es.
--
-- Aditiva y compatible hacia atrás: columna NULLABLE, sin DEFAULT, sin
-- backfill — toda Organization existente queda con organizationCategory
-- NULL (= "Sin categoría" a nivel de aplicación), exactamente igual que
-- antes de esta migración. Mismo criterio ya usado en este proyecto para
-- columnas nuevas opcionales (ver slug en
-- 20260827170000_organization_plan_limits_and_slug).
CREATE TYPE "OrganizationCategory" AS ENUM ('THEATER', 'CINEMA', 'MUSIC', 'SPORTS', 'CULTURE', 'PRODUCER', 'OTHER');

ALTER TABLE "Organization" ADD COLUMN "organizationCategory" "OrganizationCategory";
