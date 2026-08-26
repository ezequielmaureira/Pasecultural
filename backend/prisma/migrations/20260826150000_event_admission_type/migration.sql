-- Eventos gratuitos (FREE_ENTRY) — primera versión funcional.
--
-- Nueva modalidad de evento, deliberadamente NO representada con price=0:
-- un TICKETED con entradas a $0 sigue generando Sale/Ticket/QR reales
-- (control de acceso), FREE_ENTRY es puramente informativo, sin ticketing.
--
-- Aditiva y compatible hacia atrás: DEFAULT 'TICKETED' hace que todos los
-- eventos existentes queden exactamente igual que antes de esta migración,
-- sin backfill — mismo criterio ya usado acá mismo para
-- tickets.origin/sales.origin (ver 20260807150000_ticket_origin).
CREATE TYPE "EventAdmissionType" AS ENUM ('TICKETED', 'FREE_ENTRY');

ALTER TABLE "Event" ADD COLUMN "admissionType" "EventAdmissionType" NOT NULL DEFAULT 'TICKETED';
