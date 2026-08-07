import { useCallback, useEffect } from "react";
import { useAuth } from "@clerk/clerk-react";
import { usePolling } from "../../../hooks/usePolling.js";
import { listOrganizerSales } from "../../../lib/saleAdminApi.js";
import { listOrganizerTickets } from "../../../lib/ticketAdminApi.js";
import { listEventScanners } from "../../../lib/eventScannerApi.js";
import { getEventFunctionStats } from "../../../lib/functionStatsApi.js";

const POLL_INTERVAL_MS = 10000;

const EMPTY_DATA = { sales: [], tickets: [], scanners: [], functionStats: [] };

// Datos del "evento destacado" para KPIs/Timeline/Últimas ventas del
// Dashboard. `scanners` se sigue pidiendo porque buildActivityFeed lo usa
// para las entradas "scanner creado" del Timeline. `functionStats` volvió
// a este hook (se había sacado antes porque nada lo renderizaba) — ahora sí
// hace falta: es la única fuente de capacidad/emitidas/vendidas por origen
// (functionCapacity.service.js), los KPIs del Dashboard ya no las cuentan a
// mano sobre `tickets`. Misma llamada que ya usa Estado de Funciones
// (useEventStats), ningún endpoint nuevo. Toda la mecánica de CUÁNDO
// refrescar (intervalo, Page Visibility, reinicio al cambiar de evento, un
// único intervalo activo) vive en usePolling — este hook sólo aporta el QUÉ
// pedir.
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
