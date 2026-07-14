import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ChevronRight,
  Heart,
  CalendarDays,
  ShieldCheck,
  Ticket,
  UserCheck,
  Headset,
} from "lucide-react";
import Button from "../components/ui/Button.jsx";
import { CATEGORIES, FEATURED_EVENTS, TRUST_FEATURES } from "../data/publicMockData.js";

const TRUST_ICONS = {
  shield: ShieldCheck,
  ticket: Ticket,
  user: UserCheck,
  headset: Headset,
};

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0">
        <img
          src="https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?auto=format&fit=crop&w=1600&q=80"
          alt=""
          className="h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#05070B] via-[#05070Bcc] to-[#05070B33]" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#05070B] via-transparent to-transparent" />
      </div>

      <div className="relative mx-auto flex max-w-7xl flex-col gap-4 px-6 py-24 sm:py-32">
        <h1 className="max-w-xl text-4xl font-extrabold leading-tight text-white sm:text-5xl">
          Viví experiencias{" "}
          <span className="bg-gradient-to-r from-violet-400 to-blue-400 bg-clip-text text-transparent">
            que te van a encantar
          </span>
        </h1>
        <p className="max-w-md text-base text-slate-300">
          Entradas para conciertos, teatro, festivales, deportes y mucho más.
        </p>
        <div>
          <Button size="lg" className="mt-2">
            Explorar eventos
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </section>
  );
}

function CategoryBar() {
  const [active, setActive] = useState("Todos");

  return (
    <section className="mx-auto max-w-7xl px-6 py-6">
      <div className="flex gap-3 overflow-x-auto pb-1">
        {CATEGORIES.map(({ label, icon: Icon }) => {
          const isActive = active === label;
          return (
            <button
              key={label}
              type="button"
              onClick={() => setActive(label)}
              className={`flex shrink-0 flex-col items-center gap-2 rounded-xl border px-6 py-4 text-xs font-medium transition-colors duration-150 ${
                isActive
                  ? "border-violet-500 bg-violet-500/10 text-white"
                  : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white"
              }`}
            >
              <Icon
                className={`h-5 w-5 ${isActive ? "text-violet-400" : "text-slate-400"}`}
              />
              {label}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function EventCard({ event }) {
  return (
    <div className="group overflow-hidden rounded-xl border border-white/10 bg-[#0B1120] transition-colors duration-150 hover:border-white/20">
      <div className="relative h-40 w-full overflow-hidden bg-white/10">
        <div
          className={`absolute left-3 top-3 rounded-md px-2 py-1 text-[10px] font-bold tracking-wide text-white ${event.tagClass}`}
        >
          {event.tag}
        </div>
        <button
          type="button"
          aria-label="Guardar"
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur transition-colors duration-150 hover:bg-black/60"
        >
          <Heart className="h-4 w-4" />
        </button>
      </div>
      <div className="flex flex-col gap-2 p-4">
        <p className="truncate text-sm font-semibold text-white">{event.name}</p>
        <p className="truncate text-xs text-slate-400">{event.venue}</p>
        <p className="flex items-center gap-1.5 text-xs text-slate-500">
          <CalendarDays className="h-3.5 w-3.5" />
          {event.date}
        </p>
        <p className="mt-1 text-base font-bold text-violet-400">{event.price}</p>
      </div>
    </div>
  );
}

function FeaturedEvents() {
  return (
    <section className="mx-auto max-w-7xl px-6 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-white">Eventos destacados</h2>
        <Link
          to="/"
          className="flex items-center gap-1 text-sm font-medium text-violet-400 transition-colors duration-150 hover:text-violet-300"
        >
          Ver todos
          <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {FEATURED_EVENTS.map((event) => (
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
  return (
    <div className="flex flex-col">
      <Hero />
      <CategoryBar />
      <FeaturedEvents />
      <TrustBar />
    </div>
  );
}
