-- Developer > QA / Checklist — tablero personal de QA manual (NO un
-- sistema de testing automatizado, ver el informe de entrega). El
-- catálogo de funcionalidades vive versionado en código
-- (backend/src/qa/qaChecklistCatalog.js) — esta tabla guarda únicamente
-- el estado (tildado/no) de cada `key`, nunca la definición. Sin filas
-- sembradas: una `key` sin fila acá se interpreta como no verificada.

-- CreateTable
CREATE TABLE "qa_checklist_states" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "checked" BOOLEAN NOT NULL DEFAULT false,
    "checkedAt" TIMESTAMP(3),
    "checkedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qa_checklist_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "qa_checklist_states_key_key" ON "qa_checklist_states"("key");

-- AddForeignKey
ALTER TABLE "qa_checklist_states" ADD CONSTRAINT "qa_checklist_states_checkedByUserId_fkey" FOREIGN KEY ("checkedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
