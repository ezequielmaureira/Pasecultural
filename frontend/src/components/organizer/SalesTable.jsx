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

// Venta confirmada que después se devolvió (reembolso/contracargo de
// Mercado Pago, o devolución por arrepentimiento) — `sale.revenue` lo calcula
// el backend (saleRevenue.service.js). Se distingue de "Confirmada" para que
// el organizador no la cuente como recaudación vigente.
function saleStatusBadge(sale) {
  if (sale.status === "CONFIRMED" && sale.revenue?.reversed) return { label: "Reembolsada", tone: "danger" };
  if (sale.status === "CONFIRMED" && sale.revenue?.refundedAmount > 0) return { label: "Devolución parcial", tone: "warning" };
  return { label: SALE_STATUS_LABEL[sale.status] ?? sale.status, tone: SALE_STATUS_TONE[sale.status] ?? "neutral" };
}

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
              <td className="py-2.5 pr-3 text-slate-300">
                {/* MP-6 — para una venta de Mercado Pago, `total` ya incluye
                    la comisión de servicio (se SUMA, no se descuenta del
                    organizador) — mostrar acá sólo eso induciría a pensar
                    que el organizador cobra el total completo. Cuando hay
                    desglose disponible (ticketsSubtotal != null), se
                    muestra el valor de las entradas como monto principal
                    — lo que realmente le corresponde al organizador — con
                    la comisión aclarada debajo. Ventas MANUAL/Courtesy y
                    ventas de MP anteriores a esta migración no tienen
                    desglose (ticketsSubtotal null) — se muestran tal cual
                    siempre se mostraron, sin cambios. */}
                {formatCurrencyARS(sale.ticketsSubtotal ?? sale.total)}
                {sale.ticketsSubtotal != null && sale.serviceFee > 0 && (
                  <span className="block text-xs text-slate-500">
                    + {formatCurrencyARS(sale.serviceFee)} cargo Smarticket (total {formatCurrencyARS(sale.total)})
                  </span>
                )}
              </td>
              <td className="py-2.5 pr-3">
                <Badge tone={saleStatusBadge(sale).tone}>{saleStatusBadge(sale).label}</Badge>
              </td>
              <td className="py-2.5 text-slate-500">{formatDateTime(sale.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
