import { useCallback, useEffect } from "react";
import { useAuth } from "@clerk/clerk-react";
import { usePolling } from "../../../hooks/usePolling.js";
import { listOrganizerSales } from "../../../lib/saleAdminApi.js";
import { listOrganizerTickets } from "../../../lib/ticketAdminApi.js";
import { listEventScanners } from "../../../lib/eventScannerApi.js";
import { getEventFunctionStats } from "../../../lib/functionStatsApi.js";

const POLL_INTERVAL_MS = 10000;

const EMPTY_DATA = { sales: [], tickets: [], scanners: [], functionStats: [] };

// Datos del "evento destacado" para Timeline/Scanners/Funciones (Fase 1-3).
// Toda la mecánica de CUÁNDO refrescar (intervalo, Page Visibility,
// reinicio al cambiar de evento, un único intervalo activo) vive ahora en
// usePolling — este hook sólo aporta el QUÉ pedir: las mismas funciones de
// API que ya existían (con el filtro `eventId` que ya soportaban; nunca las
// `reloadEvents/Sales/Tickets` globales del contexto, que traen todo el
// historial de la organización).
//
// El contrato externo ({sales, tickets, scanners, functionStats, loading,
// error, refetch}) es exactamente el mismo de antes de este refactor — el
// Dashboard no necesitó ningún cambio.
export function useEventControlRoomData(eventId, { enabled: isOngoing }) {
  const { getToken } = useAuth();

  const fetcher = useCallback(async () => {
    const token = await getToken();
    const [sales, tickets, scanners, functionStats] = await Promise.all([
      listOrganizerSales(token, { eventId }),
      listOrganizerTickets(token, { eventId }),
      listEventScanners(token, eventId),
      getEventFunctionStats(token, eventId),
    ]);
    return { sales, tickets, scanners, functionStats };
  }, [eventId, getToken]);

  const { data, loading, error, refetch } = usePolling(fetcher, {
    intervalMs: POLL_INTERVAL_MS,
    enabled: Boolean(eventId),
    polling: Boolean(eventId) && Boolean(isOngoing),
    deps: [eventId],
  });

  // Loguea sólo cuando aparece un error nuevo (no en cada re-render
  // mientras el error sigue activo por otro cambio de estado ajeno).
  useEffect(() => {
    if (error) console.error("No se pudo cargar la información del evento destacado", error);
  }, [error]);

  return { ...(data ?? EMPTY_DATA), loading, error: Boolean(error), refetch };
}
