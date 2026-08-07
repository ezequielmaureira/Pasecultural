-- CreateIndex
-- event_scanners.email nunca tuvo índice. Soporte multi-evento para
-- Scanner: findActiveScannerByEmail (login) y resolveScannerAccess
-- (autorización por evento en cada request de un scanner con más de una
-- asignación) pasan a filtrar por email seguido — sin este índice, full
-- scan de la tabla en cada login y en cada cambio de evento.
CREATE INDEX "event_scanners_email_idx" ON "event_scanners"("email");
