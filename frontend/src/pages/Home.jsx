import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { ChevronRight, ShieldCheck, Ticket, UserCheck, Headset } from "lucide-react";
import HeroCarousel from "../components/marketplace/HeroCarousel.jsx";
import CategoryFilterBar from "../components/marketplace/CategoryFilterBar.jsx";
import EventCard from "../components/marketplace/EventCard.jsx";
import { apiFetch } from "../lib/api.js";
import { TRUST_FEATURES } from "../data/publicMockData.js";

const TRUST_ICONS = {
  shield: ShieldCheck,
  ticket: Ticket,
  user: UserCheck,
  headset: Headset,
};

function AllEvents({ events }) {
  if (events.length === 0) return null;

  return (
    <section className="mx-auto max-w-7xl px-6 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-white">Todos los eventos</h2>
        <Link
          to="/eventos"
          className="flex items-center gap-1 text-sm font-medium text-violet-400 transition-colors duration-150 hover:text-violet-300"
        >
          Ver todos
          <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {events.map((event) => (
          <EventCard key={event.id} event={event} />
        ))}
      </div>
    </section>
  );
}

function TrustBar() {
  return (
    <section className="border-t border-white/5 bg-[#0B1120]">
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-6 py-8 sm:grid-cols-2 lg:grid-cols-4">
        {TRUST_FEATURES.map(({ icon, title, subtitle }) => {
          const Icon = TRUST_ICONS[icon];
          return (
            <div key={title} className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-500/15 text-violet-400">
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">{title}</p>
                <p className="text-xs text-slate-400">{subtitle}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function Home() {
  const navigate = useNavigate();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    apiFetch("/api/events/public")
      .then(({ events: list }) => {
        if (!cancelled) setEvents(list);
      })
      .catch((err) => console.error("No se pudieron cargar los eventos", err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col">
      <HeroCarousel events={events.slice(0, 5)} />

      <section className="mx-auto max-w-7xl px-6 py-6">
        <CategoryFilterBar
          value="ALL"
          onChange={(id) =>
            navigate(id === "ALL" ? "/eventos" : `/eventos?categoria=${id}`)
          }
        />
      </section>

      {!loading && events.length === 0 && (
        <p className="mx-auto max-w-7xl px-6 py-12 text-center text-sm text-slate-500">
          Todavía no hay eventos publicados. ¡Volvé pronto!
        </p>
      )}

      <AllEvents events={events.slice(0, 8)} />
      <TrustBar />
    </div>
  );
}
