import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { Search } from "lucide-react";
import Card from "../../components/ui/Card.jsx";
import InlineErrorNotice from "../../components/ui/InlineErrorNotice.jsx";
import SalesTable from "../../components/organizer/SalesTable.jsx";
import { useOrganizerData } from "../../context/OrganizerDataContext.jsx";
import { useActiveEvent } from "../../context/ActiveEventContext.jsx";
import { listOrganizerSales } from "../../lib/saleAdminApi.js";

// SaleStatus real (schema.prisma) — no se inventa ningún estado nuevo.
// "ALL" nunca se manda al backend (ver loadSales): "Todas" es la ausencia
// de filtro de estado, no un valor de status en sí.
const STATUS_FILTERS = [
  { id: "ALL", label: "Todas" },
  { id: "CONFIRMED", label: "Confirmadas" },
  { id: "PENDING", label: "Pendientes" },
  { id: "CANCELLED", label: "Canceladas" },
  { id: "EXPIRED", label: "Vencidas" },
];

// Texto del contador — depende del filtro de estado activo para no decir
// "ventas" cuando en realidad puede haber pendientes/canceladas mezcladas
// (ver auditoría: GET /api/sales sin status devuelve cualquier estado).
const COUNTER_LABEL = {
  ALL: (n) => `${n} ${n === 1 ? "operación" : "operaciones"}`,
  CONFIRMED: (n) => `${n} ${n === 1 ? "venta confirmada" : "ventas confirmadas"}`,
  PENDING: (n) => `${n} ${n === 1 ? "venta pendiente" : "ventas pendientes"}`,
  CANCELLED: (n) => `${n} ${n === 1 ? "venta cancelada" : "ventas canceladas"}`,
  EXPIRED: (n) => `${n} ${n === 1 ? "venta vencida" : "ventas vencidas"}`,
};

// A diferencia del resto del panel (que lee `events`/`sales` ya cargados
// por OrganizerDataContext), esta pantalla necesita ventas FILTRADAS por
// evento/estado/búsqueda — filtrar eso en memoria sobre el array global
// convertiría al contexto en algo acoplado a esta pantalla puntual. En vez
// de eso, `events` se sigue leyendo del contexto (sin cambios), pero
// `sales` pasa a ser un fetch propio con `listOrganizerSales()` — la misma
// función ya usada por el contexto, sólo que acá sí se le pasan filtros. El
// Dashboard/"Últimas ventas" siguen 100% del lado del contexto global y de
// controlRoom (useEventControlRoomData), sin tocar ninguno de los dos.
export default function OrganizerSales() {
  const { getToken } = useAuth();
  const { events, loadingEvents } = useOrganizerData();
  const { activeEventId, setActiveEventId } = useActiveEvent();

  const [selectedEventId, setSelectedEventId] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (activeEventId && events.some((e) => e.id === activeEventId)) {
      setSelectedEventId((current) => current || activeEventId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEventId, events]);

  function handleChangeEvent(id) {
    setSelectedEventId(id);
    if (id) setActiveEventId(id); // el resto de las pantallas heredan esta elección
  }

  const loadSales = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const token = await getToken();
      const list = await listOrganizerSales(token, {
        eventId: selectedEventId || undefined,
        status: statusFilter === "ALL" ? undefined : statusFilter,
        buyer: search,
      });
      setSales(list ?? []);
    } catch (err) {
      console.error("No se pudieron cargar las ventas", err);
      setError(err.message || "No pudimos cargar las ventas.");
    } finally {
      setLoading(false);
    }
  }, [getToken, selectedEventId, statusFilter, search]);

  // Mismo patrón de debounce que Administración de Entradas: un único
  // timeout de 250ms que se reinicia con cualquier cambio (evento, estado o
  // búsqueda) — evita disparar un request por cada tecla, y coalesce
  // cambios simultáneos (ej. cambiar de evento mientras hay texto tipeado)
  // en un solo fetch.
  useEffect(() => {
    const timeout = setTimeout(loadSales, 250);
    return () => clearTimeout(timeout);
  }, [loadSales]);

  const counterText =
    loading && sales.length === 0
      ? "Cargando…"
      : (COUNTER_LABEL[statusFilter] ?? COUNTER_LABEL.ALL)(sales.length);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold text-white">Ventas</h1>
        <p className="text-sm text-slate-400">{counterText}</p>
      </div>

      {error && <InlineErrorNotice message={error} onRetry={loadSales} />}

      <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-[#0B1120]/90 p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <label className="flex min-w-[240px] flex-1 flex-col gap-2 text-sm text-slate-300 sm:max-w-sm">
            <span className="text-xs uppercase tracking-wide text-slate-500">Evento</span>
            <select
              value={selectedEventId}
              onChange={(e) => handleChangeEvent(e.target.value)}
              className="h-10 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-gray-100 outline-none"
              disabled={loadingEvents}
            >
              <option value="">Todos los eventos</option>
              {events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.title}
                </option>
              ))}
            </select>
          </label>

          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              className="h-10 w-full rounded-lg border border-white/10 bg-white/5 pl-9 pr-3 text-sm text-gray-100 outline-none placeholder:text-slate-500 focus:border-violet-500 focus:bg-white/10 focus:ring-2 focus:ring-violet-500/20"
              placeholder="Buscar por comprador, email o DNI"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Filtro por estado — pills compactas, mismo patrón visual que
            Administración de Entradas (aria-pressed, scroll horizontal en
            mobile en vez de comprimir etiquetas). */}
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5">
          {STATUS_FILTERS.map((filter) => {
            const isActive = statusFilter === filter.id;
            return (
              <button
                key={filter.id}
                type="button"
                aria-pressed={isActive}
                onClick={() => setStatusFilter(filter.id)}
                className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${
                  isActive
                    ? "bg-violet-600 text-white"
                    : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white"
                }`}
              >
                {filter.label}
              </button>
            );
          })}
        </div>
      </div>

      <Card>
        <SalesTable sales={sales} loading={loading && sales.length === 0} />
      </Card>
    </div>
  );
}
