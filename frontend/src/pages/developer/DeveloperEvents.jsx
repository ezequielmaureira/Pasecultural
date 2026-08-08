import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { Search, CalendarDays } from "lucide-react";
import Badge from "../../components/ui/Badge.jsx";
import InlineErrorNotice from "../../components/ui/InlineErrorNotice.jsx";
import EmptyState from "../../components/ui/EmptyState.jsx";
import { EVENT_STATUS_LABEL } from "../../lib/eventStatus.js";
import { EVENT_STATUS_TONE } from "../../components/organizer/eventStatusTone.js";
import { formatDateTime } from "../../lib/format.js";
import { listDeveloperEvents, getDeveloperOrganizationOptions } from "../../lib/developerEventsApi.js";

// EventVisibility (enum real, 2 valores) — sin pantalla previa que lo
// mostrara, así que no había ningún mapa reutilizable (a diferencia de
// EventStatus, que ya tenía EVENT_STATUS_LABEL/EVENT_STATUS_TONE). Local acá
// nomás, son sólo 2 entradas.
const VISIBILITY_LABEL = { PUBLIC: "Pública", PRIVATE: "Privada" };
const VISIBILITY_TONE = { PUBLIC: "success", PRIVATE: "neutral" };

// Los ids son EXACTAMENTE los valores del enum que espera el backend — la
// UI sólo les pone una etiqueta en español, nunca traduce un estado propio.
const STATUS_FILTERS = [
  { id: "", label: "Todos" },
  { id: "DRAFT", label: "Borrador" },
  { id: "SCHEDULED", label: "Programado" },
  { id: "PUBLISHED", label: "Publicado" },
  { id: "CANCELLED", label: "Cancelado" },
  { id: "FINISHED", label: "Finalizado" },
];

const VISIBILITY_FILTERS = [
  { id: "", label: "Todos" },
  { id: "PUBLIC", label: "Pública" },
  { id: "PRIVATE", label: "Privada" },
];

const ARCHIVED_FILTERS = [
  { id: "ACTIVE", label: "Activos" },
  { id: "ARCHIVED", label: "Archivados" },
  { id: "ALL", label: "Todos" },
];

// Mismo tratamiento visual de pill ya usado en DeveloperOrganizations.jsx
// (el único otro filtro por estado que ya existe en el panel Developer) —
// para que "Eventos" se sienta parte del mismo panel, no un patrón nuevo.
function FilterPills({ options, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const isActive = value === option.id;
        return (
          <button
            key={option.id || "ALL"}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(option.id)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors duration-150 ${
              isActive
                ? "bg-violet-500/10 text-violet-300"
                : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function TableSkeleton() {
  return (
    <tbody className="divide-y divide-white/5">
      {Array.from({ length: 6 }).map((_, i) => (
        <tr key={i}>
          <td className="px-6 py-4" colSpan={7}>
            <div className="h-5 w-full max-w-sm animate-pulse rounded bg-white/5" />
          </td>
        </tr>
      ))}
    </tbody>
  );
}

// Developer → Eventos (V1, sólo lectura) — platform-wide a propósito: nunca
// llama a nada de event.service.js (todo eso es organizer-scoped), sólo al
// endpoint nuevo GET /api/developer/events. Sin acciones: ver detalle,
// publicar, cancelar, archivar, restaurar quedan explícitamente fuera de
// esta iteración.
export default function DeveloperEvents() {
  const { getToken } = useAuth();

  const [search, setSearch] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [status, setStatus] = useState("");
  const [visibility, setVisibility] = useState("");
  const [archived, setArchived] = useState("ACTIVE");
  const [page, setPage] = useState(1);

  const [organizations, setOrganizations] = useState([]);

  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Opciones de organización — una sola vez al montar, nunca en cada
  // cambio de filtro/página (GET /api/developer/organizations/options).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const list = await getDeveloperOrganizationOptions(token);
        if (!cancelled) setOrganizations(list ?? []);
      } catch (err) {
        console.error("No se pudieron cargar las organizaciones", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const token = await getToken();
      const result = await listDeveloperEvents(token, {
        page,
        search,
        organizationId: organizationId || undefined,
        status: status || undefined,
        visibility: visibility || undefined,
        archived,
      });
      setItems(result.items ?? []);
      setPagination(result.pagination ?? { page: 1, limit: 20, total: 0, totalPages: 1 });
    } catch (err) {
      console.error("No se pudieron cargar los eventos", err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [getToken, page, search, organizationId, status, visibility, archived]);

  // Mismo patrón de debounce ya usado en Entradas/Ventas: un único timeout
  // de 250ms que se reinicia con cualquier cambio (filtros o página).
  useEffect(() => {
    const timeout = setTimeout(load, 250);
    return () => clearTimeout(timeout);
  }, [load]);

  // Cambiar cualquier filtro o la búsqueda vuelve a la página 1 — cambiar
  // de página nunca toca ningún filtro.
  function updateFilter(setter) {
    return (value) => {
      setter(value);
      setPage(1);
    };
  }
  const handleSearchChange = updateFilter(setSearch);
  const handleOrganizationChange = updateFilter(setOrganizationId);
  const handleStatusChange = updateFilter(setStatus);
  const handleVisibilityChange = updateFilter(setVisibility);
  const handleArchivedChange = updateFilter(setArchived);

  const hasFiltersActive = Boolean(search.trim() || organizationId || status || visibility || archived !== "ACTIVE");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold text-white">Eventos</h1>
        <p className="text-sm text-slate-400">
          Supervisá los eventos de todas las organizaciones de la plataforma.
        </p>
      </div>

      {error && <InlineErrorNotice message="No pudimos cargar los eventos." onRetry={load} />}

      <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-[#0B1120]/90 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="relative flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              className="h-10 w-full rounded-lg border border-white/10 bg-white/5 pl-9 pr-3 text-sm text-gray-100 outline-none placeholder:text-slate-500 focus:border-violet-500 focus:bg-white/10 focus:ring-2 focus:ring-violet-500/20"
              placeholder="Buscar por título u organización"
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
            />
          </div>

          <label className="flex min-w-[220px] flex-col gap-2 text-sm text-slate-300">
            <span className="text-xs uppercase tracking-wide text-slate-500">Organización</span>
            <select
              value={organizationId}
              onChange={(e) => handleOrganizationChange(e.target.value)}
              className="h-10 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-gray-100 outline-none"
            >
              <option value="">Todas las organizaciones</option>
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Estado</p>
          <FilterPills options={STATUS_FILTERS} value={status} onChange={handleStatusChange} />
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Visibilidad</p>
          <FilterPills options={VISIBILITY_FILTERS} value={visibility} onChange={handleVisibilityChange} />
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Archivado</p>
          <FilterPills options={ARCHIVED_FILTERS} value={archived} onChange={handleArchivedChange} />
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-[#0B1120]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-6 py-3 font-medium">Evento</th>
                <th className="px-6 py-3 font-medium">Organización</th>
                <th className="px-6 py-3 font-medium">Estado</th>
                <th className="px-6 py-3 font-medium">Visibilidad</th>
                <th className="px-6 py-3 font-medium">Próxima función</th>
                <th className="px-6 py-3 font-medium">Vendidas</th>
                <th className="px-6 py-3 font-medium">Creado</th>
              </tr>
            </thead>
            {loading ? (
              <TableSkeleton />
            ) : (
              <tbody className="divide-y divide-white/5">
                {items.map((event) => (
                  <tr key={event.id}>
                    <td className="max-w-[220px] truncate px-6 py-4 text-white">{event.title}</td>
                    <td className="max-w-[180px] truncate px-6 py-4 text-slate-300">{event.organization.name}</td>
                    <td className="px-6 py-4">
                      <Badge tone={EVENT_STATUS_TONE[event.status] ?? "neutral"}>
                        {EVENT_STATUS_LABEL[event.status] ?? event.status}
                      </Badge>
                    </td>
                    <td className="px-6 py-4">
                      <Badge tone={VISIBILITY_TONE[event.visibility] ?? "neutral"}>
                        {VISIBILITY_LABEL[event.visibility] ?? event.visibility}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 text-slate-300">
                      {event.nextFunction ? (
                        <>
                          {formatDateTime(event.nextFunction.date)}
                          {event.nextFunction.venue ? ` · ${event.nextFunction.venue}` : ""}
                        </>
                      ) : (
                        <span className="text-slate-500">Sin función vigente</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-slate-300">{event.soldTickets}</td>
                    <td className="px-6 py-4 text-slate-400">{formatDateTime(event.createdAt)}</td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr>
                    <td className="px-6 py-12" colSpan={7}>
                      <EmptyState icon={CalendarDays}>
                        {hasFiltersActive
                          ? "No encontramos eventos con esos filtros."
                          : "Todavía no hay eventos creados en la plataforma."}
                      </EmptyState>
                    </td>
                  </tr>
                )}
              </tbody>
            )}
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between text-sm text-slate-400">
        <button
          type="button"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={pagination.page <= 1}
          className="rounded-lg px-3 py-2 font-medium transition-colors duration-150 hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
        >
          Anterior
        </button>
        <span>
          Página {pagination.page} de {pagination.totalPages}
        </span>
        <button
          type="button"
          onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
          disabled={pagination.page >= pagination.totalPages}
          className="rounded-lg px-3 py-2 font-medium transition-colors duration-150 hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
        >
          Siguiente
        </button>
      </div>
    </div>
  );
}
