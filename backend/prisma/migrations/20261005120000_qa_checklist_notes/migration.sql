-- Developer > QA / Checklist — agrega una observación personal libre por
-- funcionalidad, independiente de `checked` (ver el informe de la ronda
-- "notas en QA checklist"). Columna nullable, sin default: una key
-- existente sin nota queda simplemente en NULL, nada que backfillear.

-- AlterTable
ALTER TABLE "qa_checklist_states" ADD COLUMN "note" TEXT;
