-- Developer > Planes — reorganiza organization_plan_limits para reflejar
-- las 6 reglas reales de FREE/PREMIUM (ver el informe de la ronda).
-- NO destructiva: renombra una columna (mismo dato), agrega columnas
-- nuevas con default seguro, y siembra los flags booleanos con el MISMO
-- comportamiento efectivo que tenía el chequeo hardcodeado "sólo PREMIUM"
-- (organizationPlanPolicy.js#isFeatureAvailable) antes de este cambio —
-- cero regresión para Página pública propia / WhatsApp.
-- maxCourtesiesPerEvent NO se toca: se deja de exponer desde el panel
-- Developer, pero la columna y su valor actual quedan intactos
-- (courtesy.service.js la sigue leyendo igual).

-- 1) Renombrar maxScannersPerEvent -> maxActiveScanners (mismos valores).
--    La regla real siempre fue "scanners activos de la ORGANIZACIÓN", no
--    por evento (ver eventScanner.service.js).
ALTER TABLE "organization_plan_limits" RENAME COLUMN "maxScannersPerEvent" TO "maxActiveScanners";

-- 2) Nuevo límite configurable: entradas máximas por evento. Nullable =
--    sin límite, igual que los otros 3 límites numéricos. Sin consumidor
--    todavía (ver el informe: "configurado, pendiente de enforcement").
ALTER TABLE "organization_plan_limits" ADD COLUMN "maxTicketsPerEvent" INTEGER;

-- 3) Flags de features por plan — reemplazan el chequeo hardcodeado
--    "sólo PREMIUM". NOT NULL con default false primero (columna nueva
--    sobre tabla con filas), después se corrige el valor real de cada
--    plan sembrado para no cambiar el comportamiento actual del sistema.
ALTER TABLE "organization_plan_limits" ADD COLUMN "publicOrgPageEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "organization_plan_limits" ADD COLUMN "whatsappEventCreationEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "organization_plan_limits" ADD COLUMN "featuredEligible" BOOLEAN NOT NULL DEFAULT false;

-- 4) Backfill: preserva el comportamiento efectivo previo. Antes de esta
--    migración, isFeatureAvailable() = isPremium(organization) para
--    WHATSAPP_EVENT_CREATION y PUBLIC_ORGANIZATION_PAGE — es decir,
--    PREMIUM siempre tenía ambas habilitadas y FREE nunca. Este UPDATE dos
--    hace que la nueva configuración, desde el momento en que se despliega,
--    arranque idéntica a ese comportamiento (el Developer puede cambiarlo
--    después desde Developer > Planes). featuredEligible es una regla
--    nueva sin comportamiento previo que preservar: queda en false para
--    ambos planes (default de la columna), a definir por el Developer.
UPDATE "organization_plan_limits" SET "publicOrgPageEnabled" = true, "whatsappEventCreationEnabled" = true WHERE "plan" = 'PREMIUM';
