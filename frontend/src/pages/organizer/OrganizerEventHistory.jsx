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

// "Historial de Eventos" — eventos que ya salieron del espacio operativo
// (archivado automático, ver eventArchive.service.js). Sólo lectura/acción
// limitada: buscar, ver detalle (reusa el mismo wizard de edición, que
// muestra ArchivedEventBanner en vez del formulario), restaurar, duplicar
// — las dos últimas se disparan desde ahí, no desde esta lista.
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
              : "Cuando un evento finalice (o se cancele) y pasen 7 días, va a aparecer acá automáticamente."}
          </EmptyState>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {events.map((event) => (
            <EventStatusCard key={event.id} event={event} actionLabel="Ver detalle" hideOccupancy />
          ))}
        </div>
      )}
    </div>
  );
}
