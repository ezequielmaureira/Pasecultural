-- Quick Pass V1 (imagen vertical) — capacidad aditiva del Event, deshabilitada
-- por defecto. Ambos campos son nullable/con default seguro: eventos
-- existentes quedan con quickPassEnabled=false y quickPassImageUrl=NULL,
-- comportamiento idéntico al de antes de esta migración. Sin backfill
-- necesario. No toca ninguna otra tabla ni columna.
ALTER TABLE "Event" ADD COLUMN "quickPassEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Event" ADD COLUMN "quickPassImageUrl" TEXT;
