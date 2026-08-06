import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { listOrganizerSales } from "../../../lib/saleAdminApi.js";
import { listOrganizerTickets } from "../../../lib/ticketAdminApi.js";
import { listEventScanners } from "../../../lib/eventScannerApi.js";
import { getEventFunctionStats } from "../../../lib/functionStatsApi.js";

const POLL_INTERVAL_MS = 10000;

const EMPTY_DATA = { sales: [], tickets: [], scanners: [], functionStats: [] };

// Datos del "evento destacado" para Timeline/Scanners/Funciones (Fase 1-3) —
// reusa las MISMAS funciones de API que ya existen, sólo con el filtro
// `eventId` que ya soportaban (nunca las `reloadEvents/Sales/Tickets`
// globales del contexto, que traen todo el historial de la organización).
//
// Polling (Fase 4): sólo corre si `enabled` es true (evento EN CURSO) y la
// pestaña está visible. Reglas duras:
// - Un único intervalo activo a la vez: el efecto de abajo siempre limpia el
//   intervalo anterior (cleanup de useEffect) antes de crear uno nuevo —
//   nunca puede haber dos corriendo en paralelo.
// - Cambiar de evento destacado (`eventId` distinto) reinicia todo: el mismo
//   cleanup se dispara porque `eventId` es dependencia del efecto.
// - Cambiar de pestaña detiene el polling de verdad (clearInterval, no sólo
//   "saltar el fetch"); al volver, refresca al toque y retoma el intervalo.
export function useEventControlRoomData(eventId, { enabled }) {
  const { getToken } = useAuth();
  const [data, setData] = useState(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const eventIdRef = useRef(eventId);
  eventIdRef.current = eventId;

  const fetchAll = useCallback(async () => {
    const targetEventId = eventIdRef.current;
    if (!targetEventId) return;
    try {
      const token = await getToken();
      const [sales, tickets, scanners, functionStats] = await Promise.all([
        listOrganizerSales(token, { eventId: targetEventId }),
        listOrganizerTickets(token, { eventId: targetEventId }),
        listEventScanners(token, targetEventId),
        getEventFunctionStats(token, targetEventId),
      ]);
      // Si el evento destacado cambió mientras esta llamada estaba en
      // vuelo, se descarta el resultado viejo en vez de pisar los datos del
      // evento nuevo con una respuesta tardía del anterior.
      if (eventIdRef.current !== targetEventId) return;
      setData({ sales, tickets, scanners, functionStats });
      setError(false);
    } catch (err) {
      if (eventIdRef.current !== targetEventId) return;
      console.error("No se pudo cargar la información del evento destacado", err);
      setError(true);
    } finally {
      if (eventIdRef.current === targetEventId) setLoading(false);
    }
  }, [getToken]);

  // Carga inicial (y recarga completa) cada vez que cambia el evento
  // destacado.
  useEffect(() => {
    if (!eventId) {
      setData(EMPTY_DATA);
      setError(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchAll();
  }, [eventId, fetchAll]);

  // Polling — único intervalo activo, con pausa/reanudación real por
  // visibilidad de pestaña.
  useEffect(() => {
    if (!enabled || !eventId) return undefined;

    let intervalId = null;

    function start() {
      if (intervalId) return; // ya hay uno corriendo — nunca se acumulan
      intervalId = setInterval(fetchAll, POLL_INTERVAL_MS);
    }
    function stop() {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    }
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        fetchAll();
        start();
      } else {
        stop();
      }
    }

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, eventId, fetchAll]);

  return { ...data, loading, error, refetch: fetchAll };
}
