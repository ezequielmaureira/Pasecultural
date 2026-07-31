import { Receipt } from "lucide-react";
import { useOrganizerData } from "../../context/OrganizerDataContext.jsx";

// Todavía no existe un sistema de ventas en el backend (no hay endpoint de
// órdenes/pagos, ver OrganizerDataContext) — `sales` siempre está vacío por
// ahora. Filtros y exportación se sacaron de esta pantalla a propósito: no
// tiene sentido ofrecerlos sobre una lista que nunca tiene datos reales
// todavía, y antes ni siquiera estaban conectados a nada. Cuando exista un
// backend de ventas, esta pantalla vuelve a tener tabla + filtros reales.
export default function OrganizerSales() {
  const { sales } = useOrganizerData();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold text-white">Ventas</h1>
        <p className="text-sm text-slate-400">
          {sales.length} ventas registradas
        </p>
      </div>

      <div className="rounded-xl border border-white/10 bg-[#0B1120] px-6 py-16">
        <div className="mx-auto flex max-w-sm flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-violet-500/10">
            <Receipt className="h-7 w-7 text-violet-400" />
          </div>
          <h2 className="text-base font-semibold text-white">
            Todavía no registrás ventas
          </h2>
          <p className="text-sm text-slate-400">
            Las ventas van a aparecer automáticamente acá apenas alguien
            compre una entrada de tus eventos.
          </p>
        </div>
      </div>
    </div>
  );
}
