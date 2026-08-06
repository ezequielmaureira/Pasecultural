import Card from "../ui/Card.jsx";
import SkeletonBlock from "../ui/SkeletonBlock.jsx";

// Tarjeta de KPI genérica — pensada para cualquier métrica agregada futura
// (Iteración 1 puede sumar más sin tocar este componente).
export default function KpiCard({ label, value, icon: Icon, loading = false }) {
  return (
    <Card>
      <div className="flex items-center gap-2 text-sm text-slate-400">
        {Icon && <Icon className="h-4 w-4" />}
        {label}
      </div>
      {loading ? (
        <SkeletonBlock className="mt-3 h-7 w-20" />
      ) : (
        <p className="mt-3 text-2xl font-bold text-white">{value}</p>
      )}
    </Card>
  );
}
