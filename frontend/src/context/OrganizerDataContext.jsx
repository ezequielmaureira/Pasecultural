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
// `scanners` tampoco tiene backend propio todavía: alta/baja/edición viven
// sólo en memoria de esta sesión (se pierden al recargar la página) — no
// hay ningún scanner de ejemplo precargado, sólo lo que el organizador
// agregue durante la sesión actual.
export function OrganizerDataProvider({ children }) {
  const { getToken } = useAuth();
  const [events, setEvents] = useState([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [sales] = useState([]);
  const [recentScans] = useState([]);
  const [scanners, setScanners] = useState([]);

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

  function addScanner(scanner) {
    setScanners((prev) => [
      ...prev,
      { id: `sc-${Date.now()}`, status: "Activo", lastAccess: null, assignedEvents: [], ...scanner },
    ]);
  }

  function updateScanner(id, patch) {
    setScanners((prev) => prev.map((scanner) => (scanner.id === id ? { ...scanner, ...patch } : scanner)));
  }

  function removeScanner(id) {
    setScanners((prev) => prev.filter((scanner) => scanner.id !== id));
  }

  const value = useMemo(
    () => ({
      events,
      loadingEvents,
      reloadEvents: loadEvents,
      sales,
      scanners,
      recentScans,
      addScanner,
      updateScanner,
      removeScanner,
    }),
    [events, loadingEvents, loadEvents, sales, scanners, recentScans]
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
