import { useEffect, useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { ChevronRight, ShieldCheck, Ticket, UserCheck, Headset, Search } from "lucide-react";
import HeroCarousel from "../components/marketplace/HeroCarousel.jsx";
import CategoryFilterBar from "../components/marketplace/CategoryFilterBar.jsx";
import EventsCarousel from "../components/marketplace/EventsCarousel.jsx";
import Button from "../components/ui/Button.jsx";
import { apiFetch } from "../lib/api.js";
import { TRUST_FEATURES } from "../data/publicMockData.js";

const TRUST_ICONS = { shield: ShieldCheck, ticket: Ticket, user: UserCheck, headset: Headset };

// Padding horizontal consistente en todas las secciones del Home (mismos
// pasos que usa el resto de la app para mobile/tablet/desktop).
const SECTION = "mx-auto min-w-0 max-w-7xl px-4 sm:px-6 lg:px-8";
const SECTION_SPACING = "py-6 sm:py-8";

function SectionHeader({ title, viewAllHref }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="text-lg font-bold text-white sm:text-xl">{title}</h2>
      {viewAllHref && (
        <Link
          to={viewAllHref}
          className="flex shrink-0 items-center gap-1 text-sm font-medium text-violet-400 transition-colors duration-150 hover:text-violet-300"
        >
          Ver todos <ChevronRight className="h-4 w-4" />
        </Link>
      )}
    </div>
  );
}

function UpcomingSection({ events }) {
  if (events.length === 0) return null;
  return (
    <section className={`${SECTION} ${SECTION_SPACING}`}>
      <SectionHeader title="Próximos eventos" viewAllHref="/eventos?orden=fecha" />
      <EventsCarousel events={events} />
    </section>
  );
}

function FeaturedSection({ events }) {
  if (events.length === 0) return null;
  return (
    <section className={`${SECTION} ${SECTION_SPACING}`}>
      <SectionHeader title="Eventos destacados" viewAllHref="/eventos" />
      <EventsCarousel events={events} />
    </section>
  );
}

// "Todos los eventos": carrusel horizontal en todos los tamaños de pantalla,
// igual que "Próximos" y "Destacados" (sin variante en grilla).
function AllEventsSection({ events }) {
  if (events.length === 0) return null;
  return (
    <section className={`${SECTION} ${SECTION_SPACING}`}>
      <SectionHeader title="Todos los eventos" viewAllHref="/eventos" />
      <EventsCarousel events={events} />
    </section>
  );
}

function CarouselSkeleton() {
  return (
    <section className={`${SECTION} ${SECTION_SPACING}`}>
      <div className="mb-4 h-6 w-40 animate-pulse rounded bg-white/10" />
      <div className="flex gap-4 overflow-hidden">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-64 w-52 shrink-0 animate-pulse rounded-xl bg-white/5 sm:w-60" />
        ))}
      </div>
    </section>
  );
}

function TrustBar() {
  return (
    <section className="min-w-0 border-t border-white/5 bg-[#0B1120]">
      <div className={`${SECTION} grid grid-cols-1 gap-6 py-6 sm:grid-cols-2 sm:py-8 lg:grid-cols-4`}>
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

// Acceso visible a "Recuperar mis entradas" desde el Home — sin esto, la
// única forma de llegar era escribiendo la URL a mano o volviendo a la
// pantalla de éxito de una compra anterior. Sección propia y chica, no
// compite en peso visual con las carousels de eventos (primer objetivo del
// Home sigue siendo explorar/comprar).
function RecoverPurchaseSection() {
  return (
    <section className={`${SECTION} ${SECTION_SPACING}`}>
      <div className="flex flex-col items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 p-6 text-center sm:flex-row sm:text-left">
        <div>
          <p className="text-sm font-semibold text-white">¿Ya compraste una entrada?</p>
          <p className="text-xs text-slate-400">
            Si perdiste el email, podés recuperar tus entradas con tu email y tu DNI.
          </p>
        </div>
        <Link to="/recuperar-compra" className="shrink-0">
          <Button variant="secondary" className="gap-1.5">
            <Search className="h-4 w-4" />
            Recuperar mis entradas
          </Button>
        </Link>
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

  // Cada sección ordena/filtra la misma lista de una forma distinta en vez
  // de pedir varios endpoints nuevos: "Próximos" por fecha más cercana,
  // "Destacados" como los eventos pagos, "Todos" en el orden que ya
  // devuelve la API. Sin cambios de backend.
  const upcoming = useMemo(
    () =>
      [...events]
        .filter((e) => e.startDate)
        .sort((a, b) => new Date(a.startDate) - new Date(b.startDate))
        .slice(0, 12),
    [events]
  );

  const featured = useMemo(() => events.filter((e) => !e.isFree).slice(0, 12), [events]);

  return (
    <div>
      <HeroCarousel events={events.slice(0, 5)} />

      <section className={`${SECTION} ${SECTION_SPACING}`}>
        <CategoryFilterBar
          value="ALL"
          onChange={(id) => navigate(id === "ALL" ? "/eventos" : `/eventos?categoria=${id}`)}
        />
      </section>

      {loading && (
        <>
          <CarouselSkeleton />
          <CarouselSkeleton />
        </>
      )}

      {!loading && events.length === 0 && (
        <p className={`${SECTION} ${SECTION_SPACING} text-center text-sm text-slate-500`}>
          Todavía no hay eventos publicados. ¡Volvé pronto!
        </p>
      )}

      {!loading && (
        <>
          <UpcomingSection events={upcoming} />
          <FeaturedSection events={featured} />
          <AllEventsSection events={events.slice(0, 12)} />
        </>
      )}

      <TrustBar />
      <RecoverPurchaseSection />
    </div>
  );
}
