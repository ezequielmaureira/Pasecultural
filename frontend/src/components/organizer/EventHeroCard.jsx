import { CalendarClock, MapPin } from "lucide-react";
import Badge from "../ui/Badge.jsx";
import ProgressBar from "../ui/ProgressBar.jsx";
import LinkButton from "../ui/LinkButton.jsx";
import EmptyState from "../ui/EmptyState.jsx";
import EventCoverImage from "./EventCoverImage.jsx";
import { formatShortDate, formatTime } from "../../lib/format.js";
import { formatEventLocation } from "../../lib/eventFormat.js";
import { eventEditPath } from "../../lib/organizerRoutes.js";

// Identidad visual por categoría (badge + estado vacío) — la misma
// clasificación que ya usa groupEventsByCategory (dashboardMetrics.js):
// "ongoing" | "upcoming" | "finished". `event`/`eventFunction` nulos es un
// estado real (no hay nada en esa categoría), nunca un placeholder.
const BADGE_BY_CATEGORY = {
  ongoing: { tone: "success", label: "EVENTO EN CURSO" },
  upcoming: { tone: "info", label: "Próximo evento" },
  finished: { tone: "neutral", label: "Evento finalizado" },
};

const EMPTY_STATE_BY_CATEGORY = {
  ongoing: {
    title: "No tenés eventos en curso",
    description: "Cuando una función esté activa ahora mismo, la vas a ver acá.",
  },
  upcoming: {
    title: "No tenés funciones próximas",
    description: "Publicá un evento o programá una función para verlo acá.",
  },
  finished: {
    title: "Todavía no tenés eventos finalizados",
    description: "Cuando termine una función, la vas a ver acá.",
  },
};

// Lo primero que ve el organizador al entrar al panel: el evento de la
// categoría elegida en el selector de arriba (en curso / próximo /
// finalizado).
//
// Es, a propósito, el elemento tipográficamente más grande de toda la
// pantalla (título text-2xl/3xl + sombra propia): los KPI de abajo nunca
// deben competir en peso visual con esto — ver Iteración 0.5.
export default function EventHeroCard({ event, eventFunction, category = "upcoming", sold, capacity }) {
  if (!event || !eventFunction) {
    const empty = EMPTY_STATE_BY_CATEGORY[category] ?? EMPTY_STATE_BY_CATEGORY.upcoming;
    return (
      <div className="rounded-2xl border border-white/10 bg-[#0B1120] p-8 shadow-lg shadow-black/20">
        <EmptyState icon={CalendarClock} title={empty.title}>
          {empty.description}
        </EmptyState>
      </div>
    );
  }

  const badge = BADGE_BY_CATEGORY[category] ?? BADGE_BY_CATEGORY.upcoming;

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0B1120] shadow-lg shadow-black/20">
      <div className="flex flex-col md:flex-row">
        <EventCoverImage
          src={event.coverImage}
          icon={CalendarClock}
          iconClassName="h-10 w-10"
          className="h-36 w-full sm:h-44 md:h-auto md:w-64"
        />

        <div className="flex flex-1 flex-col gap-5 p-6 sm:p-8">
          <Badge tone={badge.tone} className="w-fit">
            {badge.label}
          </Badge>

          <div>
            <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">{event.title}</h2>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                <CalendarClock className="h-4 w-4" aria-hidden="true" />
                {formatShortDate(eventFunction.date)} · {formatTime(eventFunction.date)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-4 w-4" aria-hidden="true" />
                {eventFunction.venue || formatEventLocation(event)}
              </span>
            </div>
          </div>

          <div className="max-w-sm">
            <ProgressBar value={sold} max={capacity} tone="brand" />
          </div>

          <div>
            <LinkButton to={eventEditPath(event.id)} size="lg">
              Administrar evento
            </LinkButton>
          </div>
        </div>
      </div>
    </div>
  );
}
