import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { Search, Ticket as TicketIcon, Eye } from "lucide-react";
import Badge from "../../components/ui/Badge.jsx";
import Drawer from "../../components/ui/Drawer.jsx";
import InlineErrorNotice from "../../components/ui/InlineErrorNotice.jsx";
import EmptyState from "../../components/ui/EmptyState.jsx";
import { formatDateTime, formatCurrencyARS } from "../../lib/format.js";
import {
  TICKET_STATUS_LABEL,
  ticketStatusLabel,
  ticketStatusBadgeTone,
  CHECKIN_SOURCE_LABEL,
  AUDIT_ACTION_LABEL,
  AUDIT_ACTOR_TYPE_LABEL,
} from "../organizer/ticketAdminDisplay.js";
import { getDeveloperOrganizationOptions } from "../../lib/developerEventsApi.js";
import { listDeveloperTickets, getDeveloperTicket, getDeveloperEventOptions } from "../../lib/developerTicketsApi.js";

// EventVisibility/SaleOrigin (enum real, 2 valores) — sin ningún mapa
// reutilizable existente para "origen de una entrada" en ningún lado del
// proyecto. Local acá, mismo criterio que VISIBILITY_LABEL en DeveloperEvents.jsx.
const ORIGIN_LABEL = { SALE: "Venta", COURTESY: "Cortesía" };
const ORIGIN_TONE = { SALE: "neutral", COURTESY: "info" };

const STATUS_FILTERS = [
  { id: "", label: "Todos" },
  { id: "ACTIVE", label: TICKET_STATUS_LABEL.ACTIVE },
  { id: "USED", label: TICKET_STATUS_LABEL.USED },
  { id: "CANCELLED", label: TICKET_STATUS_LABEL.CANCELLED },
  { id: "REFUNDED", label: TICKET_STATUS_LABEL.REFUNDED },
];

const ORIGIN_FILTERS = [
  { id: "", label: "Todos" },
  { id: "SALE", label: "Venta" },
  { id: "COURTESY", label: "Cortesía" },
];

// Nombres visibles distintos de los valores internos (ACTIVE/DELETED/ALL)
// a propósito, para no confundirse con las pills de Estado (que también
// tienen un valor "ACTIVE").
const DELETED_FILTERS = [
  { id: "ACTIVE", label: "Activas" },
  { id: "DELETED", label: "Eliminadas" },
  { id: "ALL", label: "Todas" },
];

const DEFAULT_PAGINATION = { page: 1, limit: 20, total: 0, totalPages: 1 };

// Mismo tratamiento visual de pill ya usado en Developer → Eventos.
function FilterPills({ options, value, onChange, disabled = false }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const isActive = value === option.id;
        return (
          <button
            key={option.id || "ALL"}
            type="button"
            aria-pressed={isActive}
            disabled={disabled}
            onClick={() => onChange(option.id)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
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
          <td className="px-6 py-4" colSpan={10}>
            <div className="h-5 w-full max-w-sm animate-pulse rounded bg-white/5" />
          </td>
        </tr>
      ))}
    </tbody>
  );
}

function InfoRow({ label, value }) {
  if (!value) return null;
  return (
    <div className="text-sm">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-slate-200">{value}</p>
    </div>
  );
}

// Detalle de sólo lectura de una entrada — sin botones administrativos a
// propósito (V1 de Developer es exclusivamente de lectura).
function TicketDrawer({ ticketId, ticket, loading, error, onClose }) {
  return (
    <Drawer title={ticket ? `Entrada ${ticket.ticketNumber}` : "Entrada"} onClose={onClose}>
      {loading && (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-5 w-full animate-pulse rounded bg-white/5" />
          ))}
        </div>
      )}

      {!loading && error && <InlineErrorNotice message="No pudimos cargar esta entrada." />}

      {!loading && !error && ticket && (
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${ticketStatusBadgeTone(ticket)}`}>
              {ticketStatusLabel(ticket)}
            </span>
            <Badge tone={ORIGIN_TONE[ticket.origin] ?? "neutral"}>{ORIGIN_LABEL[ticket.origin] ?? ticket.origin}</Badge>
          </div>

          <div className="grid grid-cols-2 gap-4 rounded-xl border border-white/10 bg-white/5 p-4">
            <InfoRow label="Evento" value={ticket.event.title} />
            <InfoRow label="Organización" value={ticket.organization.name} />
            <InfoRow
              label="Función"
              value={ticket.function ? `${formatDateTime(ticket.function.date)}${ticket.function.venue ? ` · ${ticket.function.venue}` : ""}` : null}
            />
            <InfoRow label="Tipo" value={ticket.ticketType.name} />
            <InfoRow
              label="Valor"
              value={
                ticket.unitPrice !== null
                  ? `${formatCurrencyARS(ticket.unitPrice)}${ticket.origin === "COURTESY" ? " (nominal)" : ""}`
                  : "—"
              }
            />
            <InfoRow label="Emitida" value={formatDateTime(ticket.createdAt)} />
          </div>
          {ticket.origin === "COURTESY" && (
            <p className="-mt-4 text-xs text-slate-500">Cortesía — no representa un cobro real.</p>
          )}

          <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/5 p-4">
            <InfoRow label="Comprador" value={ticket.buyer.name} />
            <InfoRow label="Correo" value={ticket.buyer.email} />
            <InfoRow label="DNI" value={ticket.buyer.document} />
          </div>

          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Check-ins ({ticket.checkIns.length})
            </h4>
            {ticket.checkIns.length === 0 ? (
              <p className="text-sm text-slate-500">Todavía no ingresó.</p>
            ) : (
              <div className="flex flex-col divide-y divide-white/5 rounded-xl border border-white/10 bg-white/5">
                {ticket.checkIns.map((checkIn) => (
                  <div key={checkIn.id} className="flex flex-col gap-0.5 px-4 py-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-200">{formatDateTime(checkIn.scannedAt)}</span>
                      <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-slate-300">
                        {CHECKIN_SOURCE_LABEL[checkIn.source] ?? checkIn.source}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">
                      {checkIn.gate ? `${checkIn.gate} · ` : ""}
                      {checkIn.scanner?.name ?? "Sin scanner asociado"}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Auditoría ({ticket.auditLogs.length})
            </h4>
            {ticket.auditLogs.length === 0 ? (
              <p className="text-sm text-slate-500">Sin acciones administrativas todavía.</p>
            ) : (
              <div className="flex flex-col divide-y divide-white/5 rounded-xl border border-white/10 bg-white/5">
                {ticket.auditLogs.map((log) => (
                  <div key={log.id} className="flex flex-col gap-1 px-4 py-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-200">{AUDIT_ACTION_LABEL[log.action] ?? log.action}</span>
                      <span className="text-xs text-slate-500">{formatDateTime(log.createdAt)}</span>
                    </div>
                    {(log.fromStatus || log.toStatus) && (
                      <p className="text-xs text-slate-500">
                        {log.fromStatus ?? "—"} → {log.toStatus ?? "—"}
                      </p>
                    )}
                    <p className="text-xs text-slate-500">
                      {AUDIT_ACTOR_TYPE_LABEL[log.actorType] ?? log.actorType}
                      {log.actorName ? `: ${log.actorName}` : ""}
                    </p>
                    {log.reason && <p className="text-xs italic text-slate-400">"{log.reason}"</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}

// Developer → Entradas (V1, sólo lectura) — platform-wide a propósito: no
// reutiliza listTicketsOrganizerService/ticketAdmin.service.js (ambos
// organizer-scoped). Sin acciones: cancelar, rehabilitar, reactivar, marcar
// usada, eliminar quedan explícitamente fuera de esta iteración.
export default function DeveloperTickets() {
  const { getToken } = useAuth();

  const [search, setSearch] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [eventId, setEventId] = useState("");
  const [status, setStatus] = useState("");
  const [origin, setOrigin] = useState("");
  const [deleted, setDeleted] = useState("ACTIVE");
  const [page, setPage] = useState(1);

  const [organizations, setOrganizations] = useState([]);
  const [eventOptions, setEventOptions] = useState([]);
  const [eventOptionsLoading, setEventOptionsLoading] = useState(false);

  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState(DEFAULT_PAGINATION);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [selectedTicketId, setSelectedTicketId] = useState(null);
  const [ticketDetail, setTicketDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(false);

  // Contadores de request en vuelo — "gana" siempre la última llamada
  // disparada, nunca la que resuelve primero. Mismo problema que el resto
  // del panel no tenía que resolver todavía (nada pedía carreras rápidas de
  // filtros/organización/drawer hasta esta pantalla), así que no hay un
  // patrón previo que copiar tal cual — esto es la extensión mínima del
  // patrón `cancelled` ya usado en DeveloperEvents.jsx para cubrir además
  // el caso de dos requests en vuelo a la vez (no sólo desmontaje).
  const ticketsRequestIdRef = useRef(0);
  const eventOptionsRequestIdRef = useRef(0);
  const detailRequestIdRef = useRef(0);

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

  // Cascada: el combo de Evento sólo tiene sentido con una organización ya
  // elegida — nunca se cargan todos los eventos de la plataforma de una.
  useEffect(() => {
    if (!organizationId) {
      setEventOptions([]);
      setEventOptionsLoading(false);
      return;
    }

    const requestId = ++eventOptionsRequestIdRef.current;
    setEventOptionsLoading(true);
    (async () => {
      try {
        const token = await getToken();
        const events = await getDeveloperEventOptions(token, organizationId);
        if (requestId !== eventOptionsRequestIdRef.current) return; // respuesta vieja, se descarta
        setEventOptions(events ?? []);
      } catch (err) {
        console.error("No se pudieron cargar los eventos de la organización", err);
        if (requestId === eventOptionsRequestIdRef.current) setEventOptions([]);
      } finally {
        if (requestId === eventOptionsRequestIdRef.current) setEventOptionsLoading(false);
      }
    })();
  }, [organizationId, getToken]);

  const loadTickets = useCallback(async () => {
    const requestId = ++ticketsRequestIdRef.current;
    setLoading(true);
    setError(false);
    try {
      const token = await getToken();
      const result = await listDeveloperTickets(token, {
        page,
        search,
        organizationId: organizationId || undefined,
        eventId: eventId || undefined,
        status: status || undefined,
        origin: origin || undefined,
        deleted,
      });
      if (requestId !== ticketsRequestIdRef.current) return; // respuesta vieja, se descarta
      setItems(result.items ?? []);
      setPagination(result.pagination ?? DEFAULT_PAGINATION);
    } catch (err) {
      console.error("No se pudieron cargar las entradas", err);
      if (requestId === ticketsRequestIdRef.current) setError(true);
    } finally {
      if (requestId === ticketsRequestIdRef.current) setLoading(false);
    }
  }, [getToken, page, search, organizationId, eventId, status, origin, deleted]);

  useEffect(() => {
    const timeout = setTimeout(loadTickets, 250);
    return () => clearTimeout(timeout);
  }, [loadTickets]);

  // Abrir un ticket dispara un nuevo requestId (aunque sea el mismo id que
  // antes): la respuesta de un ticket que ya no es el seleccionado nunca
  // pisa el drawer actual, sea por cierre o por haber abierto otro.
  useEffect(() => {
    if (!selectedTicketId) return;
    const requestId = ++detailRequestIdRef.current;
    setDetailLoading(true);
    setDetailError(false);
    (async () => {
      try {
        const token = await getToken();
        const ticket = await getDeveloperTicket(token, selectedTicketId);
        if (requestId !== detailRequestIdRef.current) return;
        setTicketDetail(ticket);
      } catch (err) {
        console.error("No se pudo cargar la entrada", err);
        if (requestId === detailRequestIdRef.current) setDetailError(true);
      } finally {
        if (requestId === detailRequestIdRef.current) setDetailLoading(false);
      }
    })();
  }, [selectedTicketId, getToken]);

  function updateFilter(setter) {
    return (value) => {
      setter(value);
      setPage(1);
    };
  }
  const handleSearchChange = updateFilter(setSearch);
  const handleStatusChange = updateFilter(setStatus);
  const handleOriginChange = updateFilter(setOrigin);
  const handleDeletedChange = updateFilter(setDeleted);

  function handleOrganizationChange(value) {
    setOrganizationId(value);
    setEventId(""); // limpiar inmediatamente, antes de que carguen las nuevas opciones
    setPage(1);
  }
  function handleEventChange(value) {
    setEventId(value);
    setPage(1);
  }

  function openTicket(id) {
    setSelectedTicketId(id);
    setTicketDetail(null);
    setDetailError(false);
  }
  function closeDrawer() {
    setSelectedTicketId(null);
    setTicketDetail(null);
    setDetailError(false);
  }

  const hasFiltersActive = Boolean(
    search.trim() || organizationId || eventId || status || origin || deleted !== "ACTIVE"
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold text-white">Entradas</h1>
        <p className="text-sm text-slate-400">
          Supervisá las entradas emitidas en toda la plataforma, de todas las organizaciones.
        </p>
      </div>

      {error && <InlineErrorNotice message="No pudimos cargar las entradas." onRetry={loadTickets} />}

      <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-[#0B1120]/90 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="relative flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              className="h-10 w-full rounded-lg border border-white/10 bg-white/5 pl-9 pr-3 text-sm text-gray-100 outline-none placeholder:text-slate-500 focus:border-violet-500 focus:bg-white/10 focus:ring-2 focus:ring-violet-500/20"
              placeholder="Buscar por número, nombre, correo o DNI"
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

          <label className="flex min-w-[220px] flex-col gap-2 text-sm text-slate-300">
            <span className="text-xs uppercase tracking-wide text-slate-500">Evento</span>
            <select
              value={eventId}
              onChange={(e) => handleEventChange(e.target.value)}
              disabled={!organizationId || eventOptionsLoading}
              className="h-10 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-gray-100 outline-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">{organizationId ? "Todos los eventos" : "Elegí una organización primero"}</option>
              {eventOptions.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.title}
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
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Origen</p>
          <FilterPills options={ORIGIN_FILTERS} value={origin} onChange={handleOriginChange} />
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Entradas eliminadas</p>
          <FilterPills options={DELETED_FILTERS} value={deleted} onChange={handleDeletedChange} />
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-[#0B1120]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-6 py-3 font-medium">Entrada</th>
                <th className="px-6 py-3 font-medium">Evento</th>
                <th className="px-6 py-3 font-medium">Organización</th>
                <th className="px-6 py-3 font-medium">Estado</th>
                <th className="px-6 py-3 font-medium">Origen</th>
                <th className="px-6 py-3 font-medium">Tipo</th>
                <th className="px-6 py-3 font-medium">Comprador</th>
                <th className="px-6 py-3 font-medium">Valor</th>
                <th className="px-6 py-3 font-medium">Emitida</th>
                <th className="px-6 py-3 font-medium text-right">Ver</th>
              </tr>
            </thead>
            {loading ? (
              <TableSkeleton />
            ) : (
              <tbody className="divide-y divide-white/5">
                {items.map((ticket) => (
                  <tr key={ticket.id}>
                    <td className="px-6 py-4 font-mono text-xs text-slate-300">{ticket.ticketNumber}</td>
                    <td className="max-w-[180px] truncate px-6 py-4 text-slate-300">{ticket.event.title}</td>
                    <td className="max-w-[160px] truncate px-6 py-4 text-slate-300">{ticket.organization.name}</td>
                    <td className="px-6 py-4">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${ticketStatusBadgeTone(ticket)}`}>
                        {ticketStatusLabel(ticket)}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <Badge tone={ORIGIN_TONE[ticket.origin] ?? "neutral"}>
                        {ORIGIN_LABEL[ticket.origin] ?? ticket.origin}
                      </Badge>
                    </td>
                    <td className="max-w-[140px] truncate px-6 py-4 text-slate-300">{ticket.ticketType.name}</td>
                    <td className="max-w-[160px] truncate px-6 py-4 text-slate-300">{ticket.buyer.name}</td>
                    <td className="px-6 py-4 text-slate-300">
                      {ticket.unitPrice !== null ? (
                        <>
                          {formatCurrencyARS(ticket.unitPrice)}
                          {ticket.origin === "COURTESY" && (
                            <span className="ml-1 text-xs text-slate-500">(nominal)</span>
                          )}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-6 py-4 text-slate-400">{formatDateTime(ticket.createdAt)}</td>
                    <td className="px-6 py-4 text-right">
                      <button
                        type="button"
                        onClick={() => openTicket(ticket.id)}
                        title="Ver"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors duration-150 hover:bg-white/5 hover:text-white"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr>
                    <td className="px-6 py-12" colSpan={10}>
                      <EmptyState icon={TicketIcon}>
                        {hasFiltersActive
                          ? "No encontramos entradas con esos filtros."
                          : "Todavía no se emitió ninguna entrada en la plataforma."}
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

      {selectedTicketId && (
        <TicketDrawer
          ticketId={selectedTicketId}
          ticket={ticketDetail}
          loading={detailLoading}
          error={detailError}
          onClose={closeDrawer}
        />
      )}
    </div>
  );
}
