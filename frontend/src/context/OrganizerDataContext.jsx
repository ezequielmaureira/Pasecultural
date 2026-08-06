import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { apiFetch } from "../lib/api.js";
import { listOrganizerSales } from "../lib/saleAdminApi.js";
import { listOrganizerTickets } from "../lib/ticketAdminApi.js";

const OrganizerDataContext = createContext(null);

// Única fuente de datos del panel de organizador para todo lo que no tiene
// su propio fetch dedicado. `events`, `sales` y `tickets` vienen siempre de
// la API real (GET /api/events/mine+detalle, GET /api/sales, GET
// /api/tickets/organizer) — nunca hay datos de ejemplo precargados acá.
// `tickets` es la lista completa del organizador (sin filtro de evento): se
// usa para agregados (KPIs, ocupación por evento en el Dashboard) — ver
// pages/organizer/dashboard/dashboardMetrics.js. OrganizerTickets.jsx (la
// pantalla de administración) sigue teniendo su propio fetch filtrado y
// paginado por evento, independiente de este.
//
// Scanners no vive acá: es información por-evento (EventScanner), no una
// lista global del organizador — ver OrganizerScanners.jsx, que fetchea
// directo GET/POST/DELETE /api/events/:id/scanners para el evento elegido.
export function OrganizerDataProvider({ children }) {
  const { getToken } = useAuth();
  const [events, setEvents] = useState([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [eventsError, setEventsError] = useState(false);
  const [sales, setSales] = useState([]);
  const [loadingSales, setLoadingSales] = useState(true);
  const [salesError, setSalesError] = useState(false);
  const [tickets, setTickets] = useState([]);
  const [loadingTickets, setLoadingTickets] = useState(true);
  const [ticketsError, setTicketsError] = useState(false);

  const loadEvents = useCallback(async () => {
    setLoadingEvents(true);
    setEventsError(false);
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
      setEventsError(true);
    } finally {
      setLoadingEvents(false);
    }
  }, [getToken]);

  const loadSales = useCallback(async () => {
    setLoadingSales(true);
    setSalesError(false);
    try {
      const token = await getToken();
      const list = await listOrganizerSales(token);
      setSales(list);
    } catch (error) {
      console.error("No se pudieron cargar las ventas del organizador", error);
      setSales([]);
      setSalesError(true);
    } finally {
      setLoadingSales(false);
    }
  }, [getToken]);

  // Sin filtro de evento a propósito: el Dashboard necesita agregados de
  // TODOS los eventos del organizador en una sola carga. Es la misma llamada
  // (GET /api/tickets/organizer) que ya usa OrganizerTickets.jsx con
  // filtros — acá se pide sin filtrar porque el costo de un solo fetch
  // completo al entrar al panel es preferible a N fetches por evento.
  const loadTickets = useCallback(async () => {
    setLoadingTickets(true);
    setTicketsError(false);
    try {
      const token = await getToken();
      const list = await listOrganizerTickets(token);
      setTickets(list);
    } catch (error) {
      console.error("No se pudieron cargar las entradas del organizador", error);
      setTickets([]);
      setTicketsError(true);
    } finally {
      setLoadingTickets(false);
    }
  }, [getToken]);

  useEffect(() => {
    loadEvents();
    loadSales();
    loadTickets();
  }, [loadEvents, loadSales, loadTickets]);

  const value = useMemo(
    () => ({
      events,
      loadingEvents,
      eventsError,
      reloadEvents: loadEvents,
      sales,
      loadingSales,
      salesError,
      reloadSales: loadSales,
      tickets,
      loadingTickets,
      ticketsError,
      reloadTickets: loadTickets,
    }),
    [
      events,
      loadingEvents,
      eventsError,
      loadEvents,
      sales,
      loadingSales,
      salesError,
      loadSales,
      tickets,
      loadingTickets,
      ticketsError,
      loadTickets,
    ]
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
