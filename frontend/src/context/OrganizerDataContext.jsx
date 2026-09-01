import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { apiFetch } from "../lib/api.js";
import { listOrganizerSales } from "../lib/saleAdminApi.js";
import { getMyEventsStats } from "../lib/functionStatsApi.js";
import { useOrganizerSession } from "./OrganizerSessionContext.jsx";

const OrganizerDataContext = createContext(null);

// Única fuente de datos del panel de organizador para todo lo que no tiene
// su propio fetch dedicado. `events`, `sales` y `eventsStats` vienen siempre
// de la API real (GET /api/events/mine+detalle, GET /api/sales, GET
// /api/events/mine/stats) — nunca hay datos de ejemplo precargados acá.
// `eventsStats` es capacidad/emitidas/vendidas/ingresadas YA agregadas por
// evento (functionCapacity.service.js#getOrganizerEventsSummaryService) — se
// usa en la grilla "Estado de mis eventos" del Dashboard. Antes acá se
// pedía la lista COMPLETA de tickets del organizador sólo para tallarla a
// mano en el cliente; se reemplazó por este resumen ya calculado en el
// backend, así ninguna pantalla vuelve a calcular vendidas/ocupación por su
// cuenta (ver auditoría "fuente única de verdad"). OrganizerTickets.jsx (la
// pantalla de administración de entradas) sigue teniendo su propio fetch de
// tickets, filtrado y paginado por evento, independiente de este.
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
  const [eventsStats, setEventsStats] = useState([]);
  const [loadingEventsStats, setLoadingEventsStats] = useState(true);
  const [eventsStatsError, setEventsStatsError] = useState(false);
  // `organization` YA NO se pide acá: viene de OrganizerSessionContext
  // (montado globalmente en App.jsx, fuente única de Organization para
  // todo Smarticket — ver el informe de entrega del botón flotante de
  // WhatsApp). Este Provider sólo REUTILIZA ese valor, nunca vuelve a
  // llamar GET /api/organizations/me.
  const { organization, loadingOrganization } = useOrganizerSession();

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

  // Un solo fetch batcheado (GET /api/events/mine/stats) en vez de N
  // consultas por evento — misma lógica que ya usa Estado de Funciones, sólo
  // agrupada un nivel más arriba (por evento en vez de por función).
  const loadEventsStats = useCallback(async () => {
    setLoadingEventsStats(true);
    setEventsStatsError(false);
    try {
      const token = await getToken();
      const list = await getMyEventsStats(token);
      setEventsStats(list);
    } catch (error) {
      console.error("No se pudieron cargar las estadísticas de los eventos del organizador", error);
      setEventsStats([]);
      setEventsStatsError(true);
    } finally {
      setLoadingEventsStats(false);
    }
  }, [getToken]);

  useEffect(() => {
    loadEvents();
    loadSales();
    loadEventsStats();
  }, [loadEvents, loadSales, loadEventsStats]);

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
      eventsStats,
      loadingEventsStats,
      eventsStatsError,
      reloadEventsStats: loadEventsStats,
      organization,
      loadingOrganization,
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
      eventsStats,
      loadingEventsStats,
      eventsStatsError,
      loadEventsStats,
      organization,
      loadingOrganization,
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
