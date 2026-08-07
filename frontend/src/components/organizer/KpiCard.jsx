import Card from "../ui/Card.jsx";
import SkeletonBlock from "../ui/SkeletonBlock.jsx";

// Tarjeta de KPI genérica — pensada para cualquier métrica agregada futura
// (Iteración 1 puede sumar más sin tocar este componente). Sin hover propio
// a propósito: no es interactiva, y darle feedback de hover implicaría que
// hace algo al tocarla.
// `hint` es opcional — una línea chica debajo del valor principal (ej. el
// desglose "520 vendidas · 38 cortesías" de "Entradas emitidas"). No agrega
// ninguna fuente de datos nueva, sólo un lugar para mostrar un detalle que
// ya viene en el mismo objeto de KPIs.
export default function KpiCard({ label, value, hint, icon: Icon, loading = false }) {
  return (
    <Card
      className="min-w-0"
      role="group"
      aria-label={loading ? `${label}: cargando` : `${label}: ${value}`}
    >
      <div className="flex items-center gap-2 text-sm text-slate-400">
        {Icon && <Icon className="h-4 w-4" aria-hidden="true" />}
        <span className="truncate">{label}</span>
      </div>
      {loading ? (
        <SkeletonBlock className="mt-3 h-7 w-20" />
      ) : (
        <>
          <p className="mt-3 truncate text-2xl font-bold text-white" title={String(value)}>
            {value}
          </p>
          {hint && <p className="mt-1 truncate text-xs text-slate-500">{hint}</p>}
        </>
      )}
    </Card>
  );
}
