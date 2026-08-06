import { Receipt } from "lucide-react";
import EmptyState from "../ui/EmptyState.jsx";
import SkeletonBlock from "../ui/SkeletonBlock.jsx";
import Badge from "../ui/Badge.jsx";
import { formatCurrencyARS, formatDateTime } from "../../lib/format.js";

// Consume directamente la forma que devuelve GET /api/sales
// (sale.service.js#SALE_LIST_INCLUDE) — sin transformar campos, para poder
// reusarse tal cual en el Dashboard (últimas N) y en /organizador/ventas
// (lista completa) sin dos versiones de la misma tabla.
const SALE_STATUS_LABEL = { PENDING: "Pendiente", CONFIRMED: "Confirmada", CANCELLED: "Cancelada", EXPIRED: "Vencida" };
const SALE_STATUS_TONE = { PENDING: "warning", CONFIRMED: "success", CANCELLED: "danger", EXPIRED: "neutral" };

export default function SalesTable({ sales, loading = false, emptyMessage = "Todavía no registrás ventas." }) {
  if (loading) {
    const widths = ["w-full", "w-11/12", "w-full", "w-10/12"];
    return (
      <div className="flex flex-col gap-3">
        {widths.map((width, i) => (
          <SkeletonBlock key={i} className={`h-10 ${width}`} />
        ))}
      </div>
    );
  }

  if (sales.length === 0) {
    return <EmptyState icon={Receipt}>{emptyMessage}</EmptyState>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead>
          <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-slate-500">
            <th className="py-2 pr-3 font-medium">Comprador</th>
            <th className="py-2 pr-3 font-medium">Evento</th>
            <th className="py-2 pr-3 font-medium">Monto</th>
            <th className="py-2 pr-3 font-medium">Estado</th>
            <th className="py-2 font-medium">Fecha</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {sales.map((sale) => (
            <tr key={sale.id} className="transition-colors duration-150 hover:bg-white/[0.03]">
              <td className="max-w-[160px] truncate py-2.5 pr-3 text-white">
                {[sale.buyer?.firstName, sale.buyer?.lastName].filter(Boolean).join(" ") || sale.buyer?.email || "—"}
              </td>
              <td className="max-w-[200px] truncate py-2.5 pr-3 text-slate-300">{sale.event?.title}</td>
              <td className="py-2.5 pr-3 text-slate-300">{formatCurrencyARS(sale.total)}</td>
              <td className="py-2.5 pr-3">
                <Badge tone={SALE_STATUS_TONE[sale.status] ?? "neutral"}>
                  {SALE_STATUS_LABEL[sale.status] ?? sale.status}
                </Badge>
              </td>
              <td className="py-2.5 text-slate-500">{formatDateTime(sale.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
