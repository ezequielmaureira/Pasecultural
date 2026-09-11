-- Fest Pass — video de fondo opcional. Aditiva y segura: ambas columnas
-- nullable, default NULL, sin tocar ninguna fila existente. No convive con
-- ningún NOT NULL ni FK nueva.
-- quickPassVideoPublicId se agrega en esta MISMA migración (todavía no
-- llegó a producción) para no fragmentar la feature en 2 migraciones: sin
-- el publicId persistido, reemplazar/borrar un video después de reabrir el
-- evento en una sesión nueva no puede limpiar el recurso viejo en
-- Cloudinary.
ALTER TABLE "Event" ADD COLUMN "quickPassVideoUrl" TEXT;
ALTER TABLE "Event" ADD COLUMN "quickPassVideoPublicId" TEXT;
