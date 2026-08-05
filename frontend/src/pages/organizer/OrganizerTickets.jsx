import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { Search, Eye, Ticket } from "lucide-react";
import Spinner from "../../components/ui/Spinner.jsx";
import { listOrganizerTickets } from "../../lib/ticketAdminApi.js";
import TicketDetailDrawer from "./components/TicketDetailDrawer.jsx";
import { ticketStatusLabel, ticketStatusBadgeTone, formatDateTime } from "./ticketAdminDisplay.js";

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
          <td className="px-6 py-4" colSpan={8}>
            <div className="h-5 w-full max-w-sm animate-pulse rounded bg-white/5" />
          </td>
        </tr>
      ))}
    </tbody>
  );
}

// Administración de entradas VENDIDAS individuales, de todos los eventos del
// organizador — distinto de "Tipos de entrada" (OrganizerTicketTypes.jsx),
// que es el catálogo General/VIP/precio. Búsqueda y filtro son server-side
// (GET /api/tickets/organizer, ver ticketAdminApi.js), mismo patrón
// debounced que DeveloperUsers.jsx — no un filtro sobre un array ya
// cargado, para no traer de una el historial completo de todos los tickets
// de organizadores con muchos eventos.
export default function OrganizerTickets() {
  const { getToken } = useAuth();

  const [statusFilter, setStatusFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState(null);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const token = await getToken();
      const data = await listOrganizerTickets(token, {
        search,
        status: statusFilter === "ALL" ? undefined : statusFilter,
      });
      setTickets(data ?? []);
    } catch (err) {
      console.error("No se pudieron cargar las entradas", err);
      setError(err.message || "No pudimos cargar las entradas.");
    } finally {
      setLoading(false);
    }
  }, [getToken, search, statusFilter]);

  useEffect(() => {
    const timeout = setTimeout(loadTickets, 250);
    return () => clearTimeout(timeout);
  }, [loadTickets]);

  // Derivado del state ya cargado, nunca un fetch aparte: al refetch-ear
  // después de una acción (onChanged del drawer), este ticket se actualiza
  // solo con el estado/checkIns/auditLogs nuevos.
  const selectedTicket = tickets.find((t) => t.id === selectedId) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold text-white">Entradas</h1>
        <p className="text-sm text-slate-400">
          Todas las entradas vendidas de tus eventos — buscá, filtrá y administrá cada una.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setStatusFilter(f.id)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors duration-150 ${
                statusFilter === f.id
                  ? "bg-violet-500/10 text-violet-300"
                  : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            className="h-10 w-full rounded-lg border border-white/10 bg-white/5 pl-9 pr-3 text-sm text-gray-100 outline-none placeholder:text-slate-500 focus:border-violet-500 focus:bg-white/10 focus:ring-2 focus:ring-violet-500/20"
            placeholder="Buscar por número, nombre, correo o DNI"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-[#0B1120]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-slate-500">
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
                    <td className="px-6 py-12" colSpan={8}>
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
                    <td className="px-6 py-12" colSpan={8}>
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

      {selectedTicket && (
        <TicketDetailDrawer ticket={selectedTicket} onClose={() => setSelectedId(null)} onChanged={loadTickets} />
      )}
    </div>
  );
}
