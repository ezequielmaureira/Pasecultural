-- La migración anterior agregó un índice único (eventId, email) pensando
-- que reemplazaba al viejo candado por userId. Error: una fila REVOKED
-- conserva su email (para el historial), y ese índice único la seguía
-- contando — bloqueaba para siempre registrar un reemplazo con el mismo
-- email en el mismo evento después de revocar a alguien. El candado real
-- contra duplicados activos vive en la aplicación (ver
-- verifyScannerInvitationCodeService, que excluye REVOKED), no en la base.

-- DropIndex
DROP INDEX "event_scanners_eventId_email_key";
