-- Developer > Contenido — agrega la tercera pestaña "Para scanners" de la
-- página pública /como-funciona. Sólo agrega un valor al enum existente:
-- no toca la tabla "content_cards" ni ninguna fila ya guardada
-- (ORGANIZER_FEST_PASS_INTRO, HOW_IT_WORKS_ATTENDEES y
-- HOW_IT_WORKS_ORGANIZERS siguen funcionando igual).
ALTER TYPE "ContentPlacement" ADD VALUE 'HOW_IT_WORKS_SCANNERS';
