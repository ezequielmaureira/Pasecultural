import { CalendarDays } from "lucide-react";
import Badge from "../ui/Badge.jsx";
import ProgressBar from "../ui/ProgressBar.jsx";
import LinkButton from "../ui/LinkButton.jsx";
import { EVENT_STATUS_LABEL } from "../../lib/eventStatus.js";
import { EVENT_STATUS_TONE } from "./eventStatusTone.js";
import { formatShortDate } from "../../lib/format.js";

// Variante compacta de EventHeroCard para la grilla "Estado de mis eventos".
// Mismos primitivos (Badge, ProgressBar, LinkButton), tamaño y densidad
// distintos — a propósito no es la misma card que la hero: acá la jerarquía
// visual tiene que quedar claramente por debajo.
export default function EventStatusCard({ event, sold, capacity }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0B1120]">
      <div
        className="h-28 w-full shrink-0 bg-slate-900 bg-cover bg-center"
        style={event.coverImage ? { backgroundImage: `url(${event.coverImage})` } : undefined}
      >
        {!event.coverImage && (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-violet-600/20 to-slate-900">
            <CalendarDays className="h-6 w-6 text-white/30" />
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-2 text-sm font-semibold text-white">{event.title}</h3>
          <Badge tone={EVENT_STATUS_TONE[event.status] ?? "neutral"}>
            {EVENT_STATUS_LABEL[event.status] ?? event.status}
          </Badge>
        </div>

        <p className="text-xs text-slate-500">{formatShortDate(event.startDate)}</p>

        <ProgressBar value={sold} max={capacity} size="sm" />

        <LinkButton
          to={`/organizador/eventos/${event.id}/editar`}
          variant="secondary"
          size="sm"
          className="mt-auto"
        >
          Administrar
        </LinkButton>
      </div>
    </div>
  );
}
