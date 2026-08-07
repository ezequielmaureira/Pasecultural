import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { CalendarRange, Gift } from "lucide-react";
import Card from "../../components/ui/Card.jsx";
import EmptyState from "../../components/ui/EmptyState.jsx";
import InlineErrorNotice from "../../components/ui/InlineErrorNotice.jsx";
import FunctionOccupancyList from "../../components/organizer/FunctionOccupancyList.jsx";
import { useOrganizerData } from "../../context/OrganizerDataContext.jsx";
import { useActiveEvent } from "../../context/ActiveEventContext.jsx";
import { useEventStats } from "../../hooks/useEventStats.js";
import { groupEventsByCategory } from "./dashboard/dashboardMetrics.js";
import { getCourtesyStats } from "../../lib/courtesyApi.js";

// Pantalla dedicada "Estado de Funciones" — antes esto sólo existía como
// sección del Dashboard (ya scopeada a un evento). Acá se agrega el
// selector propio, con el mismo Evento Activo compartido por el resto del
// panel. No agrega ningún endpoint: reusa GET /api/events/:eventId/functions/stats
// (vía useEventStats, mismo hook que ya usa Entradas) y FunctionOccupancyList
// tal cual, sin ningún cambio en las tarjetas.
export default function OrganizerFunctionStatus() {
  const { getToken } = useAuth();
  const { events, loadingEvents } = useOrganizerData();
  const { activeEventId, setActiveEventId } = useActiveEvent();
  const [selectedEventId, setSelectedEventId] = useState(null);
  // Desglose propio de Cortesías (courtesy.service.js#getCourtesyStatsService)
  // — nunca toca ni recalcula lo que ya devuelve useEventStats/
  // FunctionOccupancyList: esos siguen contando TODOS los tickets emitidos
  // (cortesía o no), exactamente como contaban antes de que este módulo
  // existiera. Esto es sólo información adicional, en su propia tarjeta.
  const [courtesyStats, setCourtesyStats] = useState(null);

  const categorized = useMemo(() => groupEventsByCategory(events, new Date()), [events]);

  // Default: el Evento Activo si existe y sigue siendo válido; si no, el
  // próximo evento disponible (con la misma prioridad que ya usa el
  // Dashboard como respaldo: próximo > en curso > cualquiera).
  useEffect(() => {
    if (loadingEvents || selectedEventId) return;

    const validActive = activeEventId && events.some((e) => e.id === activeEventId) ? activeEventId : null;
    const fallback =
      categorized.upcoming[0]?.event.id ?? categorized.ongoing[0]?.event.id ?? events[0]?.id ?? null;
    const initial = validActive ?? fallback;

    if (initial) {
      setSelectedEventId(initial);
      setActiveEventId(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingEvents, events, activeEventId]);

  function handleChangeEvent(id) {
    setSelectedEventId(id);
    setActiveEventId(id); // el resto de las pantallas heredan esta elección
  }

  const eventStats = useEventStats(selectedEventId);
  const selectedEvent = events.find((e) => e.id === selectedEventId) ?? null;

  useEffect(() => {
    if (!selectedEventId) {
      setCourtesyStats(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const stats = await getCourtesyStats(token, selectedEventId);
        if (!cancelled) setCourtesyStats(stats);
      } catch {
        // No es crítico para esta pantalla — si falla, simplemente no se
        // muestra la tarjeta de Cortesías, sin romper el resto.
        if (!cancelled) setCourtesyStats(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedEventId, getToken]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-white">
          <CalendarRange className="h-5 w-5 text-slate-400" aria-hidden="true" />
          Estado de Funciones
        </h1>
        <p className="text-sm text-slate-400">Capacidad, vendidas e ingresadas por función del evento elegido.</p>
      </div>

      <label className="flex max-w-sm flex-col gap-2 text-sm text-slate-300">
        <span className="text-xs uppercase tracking-wide text-slate-500">Evento</span>
        <select
          value={selectedEventId ?? ""}
          onChange={(e) => handleChangeEvent(e.target.value || null)}
          className="h-10 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-gray-100 outline-none"
          disabled={loadingEvents}
        >
          <option value="">Elegí un evento</option>
          {events.map((event) => (
            <option key={event.id} value={event.id}>
              {event.title}
            </option>
          ))}
        </select>
      </label>

      {eventStats.error && (
        <InlineErrorNotice message="No pudimos cargar el estado de funciones." onRetry={eventStats.refetch} />
      )}

      {!selectedEventId ? (
        <Card>
          <EmptyState icon={CalendarRange}>Elegí un evento para ver el estado de sus funciones.</EmptyState>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {selectedEvent && <p className="text-sm font-medium text-white">{selectedEvent.title}</p>}

          {courtesyStats && courtesyStats.issued > 0 && (
            <Card>
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
                <Gift className="h-4 w-4 text-violet-400" />
                Cortesías de este evento
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: "Emitidas", value: courtesyStats.issued },
                  { label: "Utilizadas", value: courtesyStats.used },
                  { label: "Pendientes", value: courtesyStats.pending },
                  { label: "Canceladas", value: courtesyStats.cancelled },
                ].map((s) => (
                  <div key={s.label} className="rounded-lg bg-white/5 px-3 py-2 text-center">
                    <p className="text-lg font-bold text-white">{s.value}</p>
                    <p className="text-xs text-slate-500">{s.label}</p>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <FunctionOccupancyList functions={eventStats.functionStats} loading={eventStats.loading} />
        </div>
      )}
    </div>
  );
}
