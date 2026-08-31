-- Premium — Fase 2D.1.1. Aditiva, nullable, sin default obligatorio.
-- Segundo color del branding Premium (estructura), independiente de
-- "brandPrimaryColor" (identidad/acento) ya existente. No modifica ninguna
-- columna existente ni ningún otro dato.
ALTER TABLE "Organization" ADD COLUMN "brandSecondaryColor" TEXT;
