import { CalendarDays } from "lucide-react";
import Badge from "../ui/Badge.jsx";
import ProgressBar from "../ui/ProgressBar.jsx";
import LinkButton from "../ui/LinkButton.jsx";
import EventCoverImage from "./EventCoverImage.jsx";
import { EVENT_STATUS_LABEL } from "../../lib/eventStatus.js";
import { EVENT_STATUS_TONE } from "./eventStatusTone.js";
import { formatShortDate } from "../../lib/format.js";
import { eventEditPath } from "../../lib/organizerRoutes.js";

// Variante compacta de EventHeroCard para la grilla "Estado de mis eventos"
// — y, con `hideOccupancy`/`actionLabel`, también para el Historial de
// Eventos (donde no se piden ventas/capacidad, sólo listar). Mismos
// primitivos (Badge, ProgressBar, LinkButton, EventCoverImage), pero
// deliberadamente más chica/densa que la hero para no competirle en
// jerarquía visual. El hover sutil (borde + elevación) es el único feedback
// que se agrega acá: son varias cards iguales en una grilla, ese
// microgesto ayuda a "leerlas" como unidades individuales sin necesitar
// hacer clic para confirmarlo.
export default function EventStatusCard({
  event,
  sold,
  capacity,
  actionLabel = "Administrar",
  hideOccupancy = false,
}) {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0B1120] transition-colors duration-200 hover:border-white/20">
      <EventCoverImage
        src={event.coverImage}
        icon={CalendarDays}
        iconClassName="h-6 w-6"
        className="h-28 w-full"
      />

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-2 text-sm font-semibold text-white">{event.title}</h3>
          <Badge tone={EVENT_STATUS_TONE[event.status] ?? "neutral"}>
            {EVENT_STATUS_LABEL[event.status] ?? event.status}
          </Badge>
        </div>

        <p className="text-xs text-slate-500">{formatShortDate(event.startDate)}</p>

        {!hideOccupancy && <ProgressBar value={sold} max={capacity} size="sm" />}

        <LinkButton
          to={eventEditPath(event.id)}
          variant="secondary"
          size="sm"
          className="mt-auto"
        >
          {actionLabel}
        </LinkButton>
      </div>
    </div>
  );
}
