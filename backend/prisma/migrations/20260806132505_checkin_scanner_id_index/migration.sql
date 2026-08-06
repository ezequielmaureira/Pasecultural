-- CreateIndex
-- check_ins.scannerId nunca tuvo índice (no es una relación formal, ver
-- schema.prisma). La Iteración 1 del Dashboard del Organizador agrega un
-- groupBy por scannerId (cantidad de ingresos / último escaneo por scanner)
-- que corre en cada carga y en cada poll cada 10s durante un evento en
-- curso — sin este índice, esa consulta escanea toda la tabla.
CREATE INDEX "check_ins_scannerId_idx" ON "check_ins"("scannerId");
