import { useMemo, useState } from "react";
import { Search, FileSpreadsheet, FileText, Eye, Send, Ban } from "lucide-react";
import Button from "../../components/ui/Button.jsx";
import { useOrganizerData } from "../../context/OrganizerDataContext.jsx";

const STATUS_STYLES = {
  Aprobada: "bg-emerald-500/10 text-emerald-400",
  Pendiente: "bg-amber-500/10 text-amber-400",
  Cancelada: "bg-rose-500/10 text-rose-400",
};

const inputClass =
  "h-10 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-gray-100 outline-none placeholder:text-slate-500 focus:border-violet-500 focus:bg-white/10 focus:ring-2 focus:ring-violet-500/20";

function Pill({ children }) {
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
        STATUS_STYLES[children] ?? "bg-white/10 text-slate-400"
      }`}
    >
      {children}
    </span>
  );
}

export default function OrganizerSales() {
  const { sales, events } = useOrganizerData();
  const [search, setSearch] = useState("");
  const [eventFilter, setEventFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [methodFilter, setMethodFilter] = useState("all");

  const eventNames = useMemo(
    () => [...new Set(events.map((e) => e.name))],
    [events]
  );
  const methods = useMemo(
    () => [...new Set(sales.map((s) => s.method))],
    [sales]
  );

  const filtered = sales.filter((sale) => {
    if (search && !sale.buyer.toLowerCase().includes(search.toLowerCase())) {
      return false;
    }
    if (eventFilter !== "all" && sale.event !== eventFilter) return false;
    if (statusFilter !== "all" && sale.status !== statusFilter) return false;
    if (methodFilter !== "all" && sale.method !== methodFilter) return false;
    return true;
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Ventas</h1>
          <p className="text-sm text-slate-400">
            {filtered.length} de {sales.length} ventas
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm">
            <FileSpreadsheet className="h-4 w-4" />
            Exportar Excel
          </Button>
          <Button variant="secondary" size="sm">
            <FileText className="h-4 w-4" />
            Exportar PDF
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            className={`${inputClass} w-56 pl-9`}
            placeholder="Buscar comprador..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className={inputClass}
          value={eventFilter}
          onChange={(e) => setEventFilter(e.target.value)}
        >
          <option value="all" className="bg-[#0B1120]">
            Todos los eventos
          </option>
          {eventNames.map((name) => (
            <option key={name} value={name} className="bg-[#0B1120]">
              {name}
            </option>
          ))}
        </select>
        <select
          className={inputClass}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all" className="bg-[#0B1120]">
            Todos los estados
          </option>
          {Object.keys(STATUS_STYLES).map((status) => (
            <option key={status} value={status} className="bg-[#0B1120]">
              {status}
            </option>
          ))}
        </select>
        <select
          className={inputClass}
          value={methodFilter}
          onChange={(e) => setMethodFilter(e.target.value)}
        >
          <option value="all" className="bg-[#0B1120]">
            Todos los métodos
          </option>
          {methods.map((method) => (
            <option key={method} value={method} className="bg-[#0B1120]">
              {method}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-xl border border-white/10 bg-[#0B1120]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-6 py-3 font-medium">Fecha</th>
                <th className="px-6 py-3 font-medium">Evento</th>
                <th className="px-6 py-3 font-medium">Comprador</th>
                <th className="px-6 py-3 font-medium">Entrada</th>
                <th className="px-6 py-3 font-medium">Método</th>
                <th className="px-6 py-3 font-medium">Estado</th>
                <th className="px-6 py-3 font-medium">Monto</th>
                <th className="px-6 py-3 font-medium text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filtered.map((sale) => (
                <tr key={sale.id}>
                  <td className="px-6 py-4 text-slate-300">
                    {new Date(sale.date).toLocaleString("es-AR", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-6 py-4 text-slate-300">{sale.event}</td>
                  <td className="px-6 py-4 font-medium text-white">
                    {sale.buyer}
                  </td>
                  <td className="px-6 py-4 text-slate-300">
                    {sale.ticketType} x{sale.quantity}
                  </td>
                  <td className="px-6 py-4 text-slate-300">{sale.method}</td>
                  <td className="px-6 py-4">
                    <Pill>{sale.status}</Pill>
                  </td>
                  <td className="px-6 py-4 font-medium text-white">
                    ${sale.amount.toLocaleString("es-AR")}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        title="Ver detalle"
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors duration-150 hover:bg-white/5 hover:text-white"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        title="Reenviar ticket"
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors duration-150 hover:bg-white/5 hover:text-white"
                      >
                        <Send className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        title="Cancelar venta"
                        disabled={sale.status === "Cancelada"}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors duration-150 hover:bg-white/5 hover:text-rose-400 disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        <Ban className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td
                    className="px-6 py-6 text-center text-slate-500"
                    colSpan={8}
                  >
                    No hay ventas que coincidan con los filtros.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
