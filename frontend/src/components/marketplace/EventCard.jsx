import { Link } from "react-router-dom";
import { CalendarDays, MapPin, ImageOff } from "lucide-react";
import { getEventCategoryLabel } from "../../lib/eventCategories.js";
import { formatEventDate, formatEventLocation, formatEventPrice } from "../../lib/eventFormat.js";

export default function EventCard({ event }) {
  return (
    <Link
      to={`/evento/${event.slug}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0B1120] transition-colors duration-150 hover:border-violet-500/40"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-white/5">
        {event.coverImage ? (
          <img
            src={event.coverImage}
            alt={event.title}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-slate-600">
            <ImageOff className="h-6 w-6" />
          </div>
        )}
        {event.category && (
          <span className="absolute left-3 top-3 rounded-md bg-violet-600/90 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
            {getEventCategoryLabel(event)}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <p className="truncate text-sm font-semibold text-white">{event.title}</p>
        {event.organization?.name && (
          <p className="truncate text-xs text-slate-500">{event.organization.name}</p>
        )}
        <p className="flex items-center gap-1.5 truncate text-xs text-slate-400">
          <CalendarDays className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{formatEventDate(event.startDate)}</span>
        </p>
        <p className="flex items-center gap-1.5 truncate text-xs text-slate-400">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{formatEventLocation(event)}</span>
        </p>
        <div className="mt-auto flex items-center justify-between pt-1.5">
          <span className="text-sm font-bold text-violet-400">
            {formatEventPrice(event)}
          </span>
          <span className="text-xs font-medium text-violet-400 group-hover:underline">
            Ver evento
          </span>
        </div>
      </div>
    </Link>
  );
}
