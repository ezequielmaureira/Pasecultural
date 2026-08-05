import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { Eye, Search, Ticket } from "lucide-react";
import Spinner from "../../components/ui/Spinner.jsx";
import ConfirmDialog from "../../components/ui/ConfirmDialog.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import { useOrganizerData } from "../../context/OrganizerDataContext.jsx";
import { bulkActionTickets, listOrganizerTickets } from "../../lib/ticketAdminApi.js";
import TicketDetailDrawer from "./components/TicketDetailDrawer.jsx";
import { formatDateTime, ticketStatusBadgeTone, ticketStatusLabel } from "./ticketAdminDisplay.js";

const STATUS_FILTERS = [
  { id: "ALL", label: "Todas" },
  { id: "ACTIVE", label: "Disponibles" },
  { id: "USED", label: "Utilizadas" },
  { id: "CANCELLED", label: "Canceladas" },
  { id: "REFUNDED", label: "Reintegradas" },
  { id: "DELETED", label: "Eliminadas" },
];

function TableSkeleton() {
  return (
    <tbody className="divide-y divide-white/5">
      {Array.from({ length: 5 }).map((_, i) => (
        <tr key={i}>
          <td className="px-6 py-4" colSpan={10}>
            <div className="h-5 w-full max-w-sm animate-pulse rounded bg-white/5" />
          </td>
        </tr>
      ))}
    </tbody>
  );
}

// Administración de entradas VENDIDAS individuales, de un evento elegido
// por el organizador — reutiliza el drawer existente y mantiene el listado
// server-side para no traer todo el historial de una vez.
export default function OrganizerTickets() {
  const { getToken } = useAuth();
  const toast = useToast();
  const { events, loadingEvents } = useOrganizerData();

  const [statusFilter, setStatusFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [selectedEventId, setSelectedEventId] = useState(null);
  const [selectedFunctionId, setSelectedFunctionId] = useState("ALL");
  const [selectedIds, setSelectedIds] = useState([]);
  const [confirmAction, setConfirmAction] = useState(null);
  const [actingBulkKey, setActingBulkKey] = useState(null);

  const selectedEvent = useMemo(
    () => events.find((event) => event.id === selectedEventId) ?? null,
    [events, selectedEventId]
  );

  const functionOptions = useMemo(() => {
    const functions = selectedEvent?.functions ?? [];
    return functions.map((fn) => ({
      id: fn.id,
      label: fn.date ? `${formatDateTime(fn.date)}${fn.venue ? ` · ${fn.venue}` : ""}` : "Función",
    }));
  }, [selectedEvent]);

  useEffect(() => {
    if (!events.length) {
      setSelectedEventId(null);
      setSelectedFunctionId("ALL");
      return;
    }

    if (!selectedEventId || !events.some((event) => event.id === selectedEventId)) {
      setSelectedEventId(events.length === 1 ? events[0].id : null);
      setSelectedFunctionId("ALL");
    }
  }, [events, selectedEventId]);

  const loadTickets = useCallback(async () => {
    if (!selectedEventId) {
      setTickets([]);
      setLoading(false);
      setError("");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const token = await getToken();
      const data = await listOrganizerTickets(token, {
        search,
        status: statusFilter === "ALL" ? undefined : statusFilter,
        eventId: selectedEventId,
        functionId: selectedFunctionId && selectedFunctionId !== "ALL" ? selectedFunctionId : undefined,
      });
      setTickets(data ?? []);
      setSelectedIds((current) => current.filter((id) => (data ?? []).some((ticket) => ticket.id === id)));
    } catch (err) {
      console.error("No se pudieron cargar las entradas", err);
      setError(err.message || "No pudimos cargar las entradas.");
    } finally {
      setLoading(false);
    }
  }, [getToken, search, selectedEventId, selectedFunctionId, statusFilter]);

  useEffect(() => {
    const timeout = setTimeout(loadTickets, 250);
    return () => clearTimeout(timeout);
  }, [loadTickets]);

  const selectedTicket = tickets.find((t) => t.id === selectedId) ?? null;

  const summary = useMemo(() => {
    const total = tickets.length;
    const disponibles = tickets.filter((ticket) => !ticket.deletedAt && ticket.status === "ACTIVE").length;
    const usadas = tickets.filter((ticket) => !ticket.deletedAt && ticket.status === "USED").length;
    const canceladas = tickets.filter((ticket) => !ticket.deletedAt && ticket.status === "CANCELLED").length;
    const reintegradas = tickets.filter((ticket) => !ticket.deletedAt && ticket.status === "REFUNDED").length;
    return { total, disponibles, usadas, canceladas, reintegradas };
  }, [tickets]);

  const allVisibleSelected = tickets.length > 0 && selectedIds.length === tickets.length;

  function toggleSelectAll() {
    if (allVisibleSelected) {
      setSelectedIds([]);
      return;
    }
    setSelectedIds(tickets.map((ticket) => ticket.id));
  }

  function toggleSelection(ticketId) {
    setSelectedIds((current) =>
      current.includes(ticketId) ? current.filter((id) => id !== ticketId) : [...current, ticketId]
    );
  }

  async function runBulkAction(actionConfig) {
    if (!selectedEventId || selectedIds.length === 0) return;

    setActingBulkKey(actionConfig.key);
    try {
      const token = await getToken();
      if (actionConfig.key === "export") {
        toast.info("La exportación de entradas seleccionadas se preparará en una próxima iteración.");
        setConfirmAction(null);
        return;
      }

      await bulkActionTickets(token, selectedEventId, {
        ticketIds: selectedIds,
        action: actionConfig.key,
      });

      toast.success(`Se actualizaron ${selectedIds.length} entradas.`);
      setSelectedIds([]);
      await loadTickets();
    } catch (err) {
      toast.error(err.message || "No pudimos completar la acción masiva.");
    } finally {
      setActingBulkKey(null);
      setConfirmAction(null);
    }
  }

  const bulkActions = [
    {
      key: "cancel",
      label: "Cancelar seleccionadas",
      danger: true,
      confirmText: "¿Deseás cancelar las entradas seleccionadas?",
    },
    {
      key: "rehabilitate",
      label: "Rehabilitar seleccionadas",
      confirmText: "¿Deseás rehabilitar las entradas seleccionadas?",
    },
    {
      key: "delete",
      label: "Eliminar seleccionadas",
      danger: true,
      confirmText: "¿Deseás eliminar las entradas seleccionadas?",
    },
    {
      key: "export",
      label: "Exportar seleccionadas",
      confirmText: "¿Deseás preparar la exportación de las entradas seleccionadas?",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold text-white">Entradas</h1>
        <p className="text-sm text-slate-400">
          Administrá tus entradas por evento y función, con filtros, selección múltiple y acciones masivas.
        </p>
      </div>

      <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-[#0B1120]/90 p-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex min-w-[240px] flex-1 flex-col gap-2 text-sm text-slate-300">
            <span className="text-xs uppercase tracking-wide text-slate-500">Evento</span>
            <select
              value={selectedEventId ?? ""}
              onChange={(event) => {
                setSelectedEventId(event.target.value || null);
                setSelectedFunctionId("ALL");
                setSelectedIds([]);
              }}
              className="h-10 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-gray-100 outline-none"
              disabled={loadingEvents}
            >
              <option value="">{events.length > 1 ? "Elegí un evento" : "Seleccionar evento"}</option>
              {events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.title}
                </option>
              ))}
            </select>
          </label>

          {functionOptions.length > 1 && (
            <label className="flex min-w-[220px] flex-1 flex-col gap-2 text-sm text-slate-300">
              <span className="text-xs uppercase tracking-wide text-slate-500">Función</span>
              <select
                value={selectedFunctionId}
                onChange={(event) => {
                  setSelectedFunctionId(event.target.value);
                  setSelectedIds([]);
                }}
                className="h-10 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-gray-100 outline-none"
                disabled={!selectedEventId}
              >
                <option value="ALL">Todas las funciones</option>
                {functionOptions.map((functionOption) => (
                  <option key={functionOption.id} value={functionOption.id}>
                    {functionOption.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            className="h-10 w-full rounded-lg border border-white/10 bg-white/5 pl-9 pr-3 text-sm text-gray-100 outline-none placeholder:text-slate-500 focus:border-violet-500 focus:bg-white/10 focus:ring-2 focus:ring-violet-500/20 disabled:cursor-not-allowed disabled:opacity-60"
            placeholder="Buscar por número, nombre, correo o DNI"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={!selectedEventId}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-5">
        {[
          { label: "Total", value: summary.total },
          { label: "Disponibles", value: summary.disponibles },
          { label: "Usadas", value: summary.usadas },
          { label: "Canceladas", value: summary.canceladas },
          { label: "Reintegradas", value: summary.reintegradas },
        ].map((item) => (
          <div key={item.label} className="rounded-xl border border-white/10 bg-[#0B1120] p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">{item.label}</p>
            <p className="mt-2 text-2xl font-semibold text-white">{item.value}</p>
          </div>
        ))}
      </div>

      {selectedIds.length > 0 && (
        <div className="flex flex-col gap-3 rounded-xl border border-violet-500/20 bg-violet-500/10 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-violet-200">{selectedIds.length} entradas seleccionadas</p>
            <p className="text-xs text-violet-300/90">Elegí una acción para ejecutarla sobre todas ellas.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {bulkActions.map((action) => (
              <button
                key={action.key}
                type="button"
                onClick={() => setConfirmAction({ ...action, key: action.key })}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  action.danger ? "bg-rose-500/15 text-rose-300 hover:bg-rose-500/25" : "bg-white/10 text-slate-200 hover:bg-white/15"
                }`}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {!selectedEventId ? (
        <div className="rounded-xl border border-dashed border-white/10 bg-[#0B1120] p-12 text-center text-sm text-slate-400">
          Elegí un evento para ver sus entradas y empezar a administrar.
        </div>
      ) : (
        <div className="rounded-xl border border-white/10 bg-[#0B1120]">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3 font-medium">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-white/15 bg-transparent"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAll}
                      disabled={tickets.length === 0}
                    />
                  </th>
                  <th className="px-6 py-3 font-medium">Número</th>
                  <th className="px-6 py-3 font-medium">Evento</th>
                  <th className="px-6 py-3 font-medium">Función</th>
                  <th className="px-6 py-3 font-medium">Comprador</th>
                  <th className="px-6 py-3 font-medium">Correo</th>
                  <th className="px-6 py-3 font-medium">Estado</th>
                  <th className="px-6 py-3 font-medium">Fecha de compra</th>
                  <th className="px-6 py-3 font-medium text-right">Ver</th>
                </tr>
              </thead>
              {loading && tickets.length === 0 ? (
                <TableSkeleton />
              ) : (
                <tbody className="divide-y divide-white/5">
                  {tickets.map((ticket) => (
                    <tr key={ticket.id}>
                      <td className="px-4 py-4">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-white/15 bg-transparent"
                          checked={selectedIds.includes(ticket.id)}
                          onChange={() => toggleSelection(ticket.id)}
                        />
                      </td>
                      <td className="px-6 py-4 font-mono text-xs text-slate-300">{ticket.ticketNumber}</td>
                      <td className="px-6 py-4 text-slate-300">{ticket.eventTitle}</td>
                      <td className="px-6 py-4 text-slate-300">{formatDateTime(ticket.functionDate)}</td>
                      <td className="px-6 py-4 text-slate-300">{ticket.buyerName}</td>
                      <td className="px-6 py-4 text-slate-400">{ticket.buyerEmail}</td>
                      <td className="px-6 py-4">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${ticketStatusBadgeTone(ticket)}`}>
                          {ticketStatusLabel(ticket)}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-slate-400">{formatDateTime(ticket.createdAt)}</td>
                      <td className="px-6 py-4 text-right">
                        <button
                          type="button"
                          onClick={() => setSelectedId(ticket.id)}
                          title="Ver"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors duration-150 hover:bg-white/5 hover:text-white"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!loading && tickets.length === 0 && !error && (
                    <tr>
                      <td className="px-6 py-12" colSpan={10}>
                        <div className="flex flex-col items-center gap-3 text-center">
                          <Ticket className="h-8 w-8 text-slate-600" />
                          <p className="text-sm text-slate-400">
                            {search.trim() || statusFilter !== "ALL"
                              ? "No encontramos entradas con esos filtros."
                              : "Todavía no se vendió ninguna entrada."}
                          </p>
                        </div>
                      </td>
                    </tr>
                  )}
                  {error && (
                    <tr>
                      <td className="px-6 py-12" colSpan={10}>
                        <p className="text-center text-sm text-rose-400">{error}</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              )}
            </table>
          </div>
          {loading && tickets.length > 0 && (
            <div className="flex items-center justify-center gap-2 border-t border-white/10 py-3 text-xs text-slate-500">
              <Spinner size="xs" />
              Actualizando...
            </div>
          )}
        </div>
      )}

      {selectedTicket && (
        <TicketDetailDrawer ticket={selectedTicket} onClose={() => setSelectedId(null)} onChanged={loadTickets} />
      )}

      {confirmAction && (
        <ConfirmDialog
          title={confirmAction.label}
          description={confirmAction.confirmText}
          confirmLabel={confirmAction.label}
          danger={confirmAction.danger}
          loading={actingBulkKey === confirmAction.key}
          onConfirm={() => runBulkAction(confirmAction)}
          onClose={() => setConfirmAction(null)}
        />
      )}
    </div>
  );
}
