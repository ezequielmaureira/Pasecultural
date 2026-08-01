import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { apiFetch } from "../lib/api.js";

const OrganizerDataContext = createContext(null);

// Única fuente de datos del panel de organizador para todo lo que no tiene
// su propio fetch dedicado (Dashboard, Entradas). `events` viene siempre de
// la API real — nunca hay datos de ejemplo precargados acá.
//
// `sales` y `recentScans` quedan intencionalmente vacíos: todavía no existe
// un sistema de ventas/escaneos en el backend (no hay endpoint de órdenes ni
// de escaneos), así que mostrar algo ahí sería inventar información. En
// cuanto exista ese backend, esto pasa a fetchear igual que `events`.
//
// Scanners ya NO vive acá: es información por-evento (EventScanner), no una
// lista global del organizador — ver OrganizerScanners.jsx, que fetchea
// directo GET/POST/DELETE /api/events/:id/scanners para el evento elegido.
export function OrganizerDataProvider({ children }) {
  const { getToken } = useAuth();
  const [events, setEvents] = useState([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [sales] = useState([]);
  const [recentScans] = useState([]);

  const loadEvents = useCallback(async () => {
    setLoadingEvents(true);
    try {
      const token = await getToken();
      const { events: list } = await apiFetch("/api/events/mine", { token });
      // "/mine" no trae ticketTypes/functions (es un listado liviano):
      // se completa cada evento con su detalle real para que Dashboard y
      // Entradas puedan mostrar tipos de entrada sin inventar nada.
      const detailed = await Promise.all(
        list.map((event) =>
          apiFetch(`/api/events/${event.id}`, { token })
            .then((res) => res.event)
            .catch(() => event)
        )
      );
      setEvents(detailed);
    } catch (error) {
      console.error("No se pudieron cargar los eventos del organizador", error);
      setEvents([]);
    } finally {
      setLoadingEvents(false);
    }
  }, [getToken]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const value = useMemo(
    () => ({
      events,
      loadingEvents,
      reloadEvents: loadEvents,
      sales,
      recentScans,
    }),
    [events, loadingEvents, loadEvents, sales, recentScans]
  );

  return <OrganizerDataContext.Provider value={value}>{children}</OrganizerDataContext.Provider>;
}

export function useOrganizerData() {
  const ctx = useContext(OrganizerDataContext);
  if (!ctx) {
    throw new Error("useOrganizerData debe usarse dentro de OrganizerDataProvider");
  }
  return ctx;
}
