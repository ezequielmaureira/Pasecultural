import { CalendarRange } from "lucide-react";
import EmptyState from "../ui/EmptyState.jsx";
import SkeletonBlock from "../ui/SkeletonBlock.jsx";
import ProgressBar from "../ui/ProgressBar.jsx";
import { formatShortDate, formatTime } from "../../lib/format.js";

function Stat({ label, value }) {
  return (
    <div>
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

function FunctionOccupancyRow({ fn }) {
  const hasCapacity = typeof fn.capacity === "number" && fn.capacity > 0;
  const available = hasCapacity ? Math.max(fn.capacity - fn.sold, 0) : null;

  return (
    <div className="rounded-lg border border-white/10 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-white">
          {formatShortDate(fn.date)} · {formatTime(fn.date)}
        </p>
        {fn.venue && <p className="text-xs text-slate-500">{fn.venue}</p>}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-3 text-center">
        <Stat label="Vendidas" value={fn.sold} />
        <Stat label="Ingresadas" value={fn.checkedIn} />
        <Stat label="Disponibles" value={available ?? "—"} />
      </div>

      <div className="mt-3">
        <ProgressBar value={fn.sold} max={fn.capacity} secondaryValue={fn.checkedIn} tone="brand" secondaryTone="success" />
      </div>
    </div>
  );
}

// Genérico: recibe `functions` con la forma exacta que ya devuelve
// GET /api/events/:eventId/functions/stats (functionCapacity.service.js#
// getEventFunctionStats) — no sabe nada del Dashboard, sirve igual para una
// futura pantalla "Evento en Vivo".
export default function FunctionOccupancyList({
  functions,
  loading = false,
  emptyMessage = "Este evento todavía no tiene funciones programadas.",
}) {
  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <SkeletonBlock key={i} className="h-28 rounded-lg" />
        ))}
      </div>
    );
  }

  if (functions.length === 0) {
    return <EmptyState icon={CalendarRange}>{emptyMessage}</EmptyState>;
  }

  return (
    <div className="flex flex-col gap-3">
      {functions.map((fn) => (
        <FunctionOccupancyRow key={fn.functionId} fn={fn} />
      ))}
    </div>
  );
}
