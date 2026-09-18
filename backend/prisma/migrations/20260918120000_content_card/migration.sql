-- Developer > Contenido (V1 mínima) — un único placement soportado hoy:
-- la introducción de Organizer > Fest Pass. Tabla nueva, aditiva, no toca
-- ninguna fila/tabla existente.
CREATE TYPE "ContentPlacement" AS ENUM ('ORGANIZER_FEST_PASS_INTRO');

CREATE TABLE "content_cards" (
    "id" TEXT NOT NULL,
    "placement" "ContentPlacement" NOT NULL,
    "imageUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_cards_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "content_cards_placement_key" ON "content_cards"("placement");
