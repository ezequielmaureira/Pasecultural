import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, CalendarDays, MapPin, ImageOff } from "lucide-react";
import Button from "../ui/Button.jsx";
import { getEventCategoryLabel } from "../../lib/eventCategories.js";
import { formatEventDate, formatEventLocation } from "../../lib/eventFormat.js";

const AUTOPLAY_MS = 6000;

export default function HeroCarousel({ events }) {
  const navigate = useNavigate();
  const [index, setIndex] = useState(0);

  const count = events.length;

  useEffect(() => {
    if (count < 2) return;
    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % count);
    }, AUTOPLAY_MS);
    return () => clearInterval(timer);
  }, [count]);

  if (count === 0) return null;

  const event = events[index];

  function goTo(next) {
    setIndex(((next % count) + count) % count);
  }

  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0">
        {event.coverImage ? (
          <img
            key={event.id}
            src={event.coverImage}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-white/5 text-slate-700">
            <ImageOff className="h-10 w-10" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-[#05070B] via-[#05070Bcc] to-[#05070B33]" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#05070B] via-transparent to-transparent" />
      </div>

      <div className="relative mx-auto flex max-w-7xl flex-col gap-3 px-4 py-14 sm:gap-4 sm:px-6 sm:py-24 lg:px-8 lg:py-32">
        {event.category && (
          <span className="w-fit rounded-full bg-violet-500/15 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-violet-300">
            {getEventCategoryLabel(event)}
          </span>
        )}
        <h1 className="max-w-xl text-3xl font-extrabold leading-tight text-white sm:text-4xl lg:text-5xl">
          {event.title}
        </h1>
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-300 sm:gap-4">
          <span className="flex items-center gap-1.5">
            <CalendarDays className="h-4 w-4" />
            {formatEventDate(event.startDate)}
          </span>
          <span className="flex items-center gap-1.5">
            <MapPin className="h-4 w-4" />
            {formatEventLocation(event)}
          </span>
        </div>
        <div>
          <Button
            size="lg"
            className="mt-2"
            onClick={() => navigate(`/evento/${event.slug}`)}
          >
            Ver Evento
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {count > 1 && (
        <>
          <button
            type="button"
            aria-label="Evento anterior"
            onClick={() => goTo(index - 1)}
            className="absolute left-4 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur transition-colors duration-150 hover:bg-black/60"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label="Próximo evento"
            onClick={() => goTo(index + 1)}
            className="absolute right-4 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur transition-colors duration-150 hover:bg-black/60"
          >
            <ChevronRight className="h-5 w-5" />
          </button>

          <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2">
            {events.map((e, i) => (
              <button
                key={e.id}
                type="button"
                aria-label={`Ir al evento ${i + 1}`}
                onClick={() => goTo(i)}
                className={`h-1.5 rounded-full transition-all duration-150 ${
                  i === index ? "w-6 bg-violet-400" : "w-1.5 bg-white/30 hover:bg-white/50"
                }`}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
