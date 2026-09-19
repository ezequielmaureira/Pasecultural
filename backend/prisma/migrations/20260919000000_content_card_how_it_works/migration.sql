-- Developer > Contenido — agrega dos placements nuevos para las pestañas
-- "Para asistentes" / "Para organizadores" de la página pública
-- /como-funciona. Sólo agrega valores al enum existente: no toca la tabla
-- "content_cards" ni ninguna fila ya guardada (ORGANIZER_FEST_PASS_INTRO
-- sigue funcionando igual).
ALTER TYPE "ContentPlacement" ADD VALUE 'HOW_IT_WORKS_ATTENDEES';
ALTER TYPE "ContentPlacement" ADD VALUE 'HOW_IT_WORKS_ORGANIZERS';
