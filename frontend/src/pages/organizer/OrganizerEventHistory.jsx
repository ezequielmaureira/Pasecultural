import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { History } from "lucide-react";
import Card from "../../components/ui/Card.jsx";
import EmptyState from "../../components/ui/EmptyState.jsx";
import SkeletonBlock from "../../components/ui/SkeletonBlock.jsx";
import InlineErrorNotice from "../../components/ui/InlineErrorNotice.jsx";
import SearchInput from "../../components/ui/SearchInput.jsx";
import EventStatusCard from "../../components/organizer/EventStatusCard.jsx";
import { listArchivedEvents } from "../../lib/eventArchiveApi.js";
import { eventHistoryDetailPath } from "../../lib/organizerRoutes.js";
import { formatCurrencyARS } from "../../lib/format.js";

// "Historial de Eventos" — eventos que ya salieron del espacio operativo
// (archivado automático, ver eventArchive.service.js). Sólo lectura: cada
// card ya trae un resumen liviano (vendidas/ingresaron/recaudación, ver
// event.service.js#listArchivedEventsService) y "Ver resumen" navega al
// informe histórico completo (OrganizerEventHistoryDetail.jsx) — ya NO al
// wizard de edición. Duplicar se dispara desde ESA pantalla, no
// desde esta lista (ver el informe de la ronda "Historial de Eventos
// completo"). Este listado tiene que sentirse como archivo, no como
// gestor de eventos activos.
export default function OrganizerEventHistory() {
  const { getToken } = useAuth();

  const [search, setSearch] = useState("");
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const token = await getToken();
      const list = await listArchivedEvents(token, { search });
      setEvents(list);
    } catch (err) {
      console.error("No se pudo cargar el historial de eventos", err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [getToken, search]);

  useEffect(() => {
    const timeout = setTimeout(loadEvents, 250);
    return () => clearTimeout(timeout);
  }, [loadEvents]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-white">
          <History className="h-5 w-5 text-slate-400" aria-hidden="true" />
          Historial de Eventos
        </h1>
        <p className="text-sm text-slate-400">
          Eventos finalizados o cancelados que ya no requieren gestión. Toda su información se conserva.
        </p>
      </div>

      <SearchInput
        placeholder="Buscar por nombre del evento"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      {error ? (
        <InlineErrorNotice message="No pudimos cargar el historial de eventos." onRetry={loadEvents} />
      ) : loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      ) : events.length === 0 ? (
        <Card>
          <EmptyState icon={History} title="Todavía no hay eventos en el historial">
            {search.trim()
              ? "No encontramos eventos con esa búsqueda."
              : "Cuando un evento finalice va a aparecer acá automáticamente. Uno cancelado aparece 7 días después de la cancelación."}
          </EmptyState>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {events.map((event) => (
            <EventStatusCard
              key={event.id}
              event={event}
              actionLabel="Ver resumen"
              hideOccupancy
              to={eventHistoryDetailPath(event.id)}
              extra={
                <dl className="grid grid-cols-3 gap-1 text-[11px] text-slate-500">
                  <div>
                    <dt className="truncate">Vendidas</dt>
                    <dd className="font-semibold text-slate-300">{event.sold ?? 0}</dd>
                  </div>
                  <div>
                    <dt className="truncate">Ingresaron</dt>
                    <dd className="font-semibold text-slate-300">{event.checkedIn ?? 0}</dd>
                  </div>
                  <div>
                    <dt className="truncate">Recaudación</dt>
                    <dd className="truncate font-semibold text-slate-300">{formatCurrencyARS(event.revenue ?? 0)}</dd>
                  </div>
                </dl>
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
