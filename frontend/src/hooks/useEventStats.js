import { useCallback } from "react";
import { useAuth } from "@clerk/clerk-react";
import { usePolling } from "./usePolling.js";
import { listOrganizerSales } from "../lib/saleAdminApi.js";
import { getEventFunctionStats } from "../lib/functionStatsApi.js";

const EMPTY = { functionStats: [], sales: [] };

// Estadísticas reales de un evento (capacidad/vendidas/ingresadas por
// función + ventas confirmadas) — carga única por evento, `polling: false`
// a propósito: esta información nunca depende de búsqueda/filtro/estado/
// paginación de la pantalla que la consuma, así que no hace falta
// refrescarla sola en vivo (a diferencia del "evento destacado" del
// Dashboard, que sí pollea). Reutiliza los mismos endpoints que ya usa el
// Dashboard (GET /api/events/:eventId/functions/stats, GET /api/sales) —
// ver components/organizer/functionStatsSelectors.js para cómo se combinan
// estos dos arrays en KPIs mostrables.
export function useEventStats(eventId) {
  const { getToken } = useAuth();

  const fetcher = useCallback(async () => {
    const token = await getToken();
    const [functionStats, sales] = await Promise.all([
      getEventFunctionStats(token, eventId),
      listOrganizerSales(token, { eventId }),
    ]);
    return { functionStats, sales };
  }, [eventId, getToken]);

  const { data, loading, error, refetch } = usePolling(fetcher, {
    enabled: Boolean(eventId),
    polling: false,
    deps: [eventId],
  });

  return { ...(data ?? EMPTY), loading, error: Boolean(error), refetch };
}
