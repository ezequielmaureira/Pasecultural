import { Activity } from "lucide-react";
import EmptyState from "../ui/EmptyState.jsx";
import SkeletonBlock from "../ui/SkeletonBlock.jsx";
import { ACTIVITY_TYPES, DEFAULT_ACTIVITY_TYPE } from "./activityTypes.js";
import { formatRelativeTime, formatDateTime } from "../../lib/format.js";

// Mismos 5 tonos que ya usa Badge.jsx — el círculo del ícono reusa esa
// misma paleta, no una nueva.
const ICON_TONE_CLASSES = {
  neutral: "bg-white/10 text-slate-300",
  success: "bg-emerald-500/10 text-emerald-400",
  warning: "bg-amber-500/10 text-amber-400",
  danger: "bg-rose-500/10 text-rose-400",
  info: "bg-sky-500/10 text-sky-400",
};

function ActivityTimelineItem({ item, now }) {
  const { icon: Icon, tone } = ACTIVITY_TYPES[item.type] ?? DEFAULT_ACTIVITY_TYPE;

  return (
    <li className="flex gap-3 py-3 first:pt-0 last:pb-0">
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
          ICON_TONE_CLASSES[tone] ?? ICON_TONE_CLASSES.neutral
        }`}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="truncate text-sm font-medium text-white">{item.title}</p>
          {/* Fecha exacta en el tooltip nativo (title) — la relativa es la
              que se lee de un vistazo, la exacta queda a un hover/foco. */}
          <time
            dateTime={new Date(item.timestamp).toISOString()}
            title={formatDateTime(item.timestamp)}
            className="shrink-0 text-xs text-slate-500"
          >
            {formatRelativeTime(item.timestamp, now)}
          </time>
        </div>
        <p className="mt-0.5 truncate text-sm text-slate-400">{item.description}</p>
      </div>
    </li>
  );
}

// Genérico a propósito: recibe `items` ya armados
// ({id, type, title, description, timestamp}) — no sabe nada de
// ventas/tickets/scanners. Sirve igual para el Dashboard que para una
// futura pantalla "Evento en Vivo" (misma forma de entrada).
export default function ActivityTimeline({
  items,
  now,
  loading = false,
  emptyMessage = "Todavía no hay actividad para mostrar.",
}) {
  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonBlock key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return <EmptyState icon={Activity}>{emptyMessage}</EmptyState>;
  }

  return (
    <ul className="flex flex-col divide-y divide-white/5">
      {items.map((item) => (
        <ActivityTimelineItem key={item.id} item={item} now={now} />
      ))}
    </ul>
  );
}
