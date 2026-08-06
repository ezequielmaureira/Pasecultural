import { CalendarClock, MapPin } from "lucide-react";
import Badge from "../ui/Badge.jsx";
import ProgressBar from "../ui/ProgressBar.jsx";
import LinkButton from "../ui/LinkButton.jsx";
import EmptyState from "../ui/EmptyState.jsx";
import { formatShortDate, formatTime } from "../../lib/format.js";
import { formatEventLocation } from "../../lib/eventFormat.js";

// Lo primero que ve el organizador al entrar al panel: el evento en curso
// (si hay uno) o, si no, la próxima función programada. `event`/`eventFunction`
// nulos es un estado real (no hay funciones próximas), no un placeholder.
export default function EventHeroCard({ event, eventFunction, isOngoing, sold, capacity }) {
  if (!event || !eventFunction) {
    return (
      <div className="rounded-2xl border border-white/10 bg-[#0B1120] p-8">
        <EmptyState icon={CalendarClock} title="No tenés funciones próximas">
          Publicá un evento o programá una función para verlo acá.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0B1120]">
      <div className="flex flex-col md:flex-row">
        <div
          className="h-40 w-full shrink-0 bg-slate-900 bg-cover bg-center md:h-auto md:w-64"
          style={event.coverImage ? { backgroundImage: `url(${event.coverImage})` } : undefined}
        >
          {!event.coverImage && (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-violet-600/30 to-slate-900">
              <CalendarClock className="h-10 w-10 text-white/40" />
            </div>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-4 p-6">
          {isOngoing ? (
            <Badge tone="success" className="w-fit">
              EVENTO EN CURSO
            </Badge>
          ) : (
            <Badge tone="info" className="w-fit">
              Próximo evento
            </Badge>
          )}

          <div>
            <h2 className="text-lg font-bold text-white">{event.title}</h2>
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                <CalendarClock className="h-4 w-4" />
                {formatShortDate(eventFunction.date)} · {formatTime(eventFunction.date)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-4 w-4" />
                {eventFunction.venue || formatEventLocation(event)}
              </span>
            </div>
          </div>

          <div className="max-w-sm">
            <ProgressBar value={sold} max={capacity} tone="brand" />
          </div>

          <div>
            <LinkButton to={`/organizador/eventos/${event.id}/editar`}>Administrar evento</LinkButton>
          </div>
        </div>
      </div>
    </div>
  );
}
