import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Clock, Mail, Ticket, CalendarPlus } from "lucide-react";

// Página pública "Costos y comisiones". Por ahora SÓLO estructura: los
// porcentajes, tarifas y reglas de cobro todavía no están definidos, así que
// cada pestaña muestra un aviso de "en preparación" en vez de inventar datos.
// Cuando se definan, completar cada panel acá (no hay lógica de cobro en
// este archivo: es solo texto informativo).
const TABS = [
  {
    key: "attendees",
    label: "Para asistentes",
    icon: Ticket,
    title: "Costos para asistentes",
    description: "Acá vas a encontrar qué se cobra al comprar una entrada en Smarticket.",
  },
  {
    key: "organizers",
    label: "Para organizadores",
    icon: CalendarPlus,
    title: "Comisiones para organizadores",
    description: "Acá vas a encontrar qué se cobra al publicar y vender entradas de tu evento en Smarticket.",
  },
];

function PendingPanel({ icon: Icon, title, description }) {
  return (
    <div className="smarticket-neon-surface mx-auto flex max-w-2xl flex-col items-center gap-4 rounded-2xl px-5 py-10 text-center sm:px-10">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand/15 text-brand shadow-[0_0_14px_-4px_rgba(132,204,22,0.55)]">
        <Icon className="h-6 w-6" />
      </div>
      <h2 className="text-xl font-bold text-white light:text-slate-900 sm:text-2xl">{title}</h2>
      <p className="max-w-md text-sm text-slate-400 light:text-slate-500">{description}</p>
      <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/40 bg-brand/10 px-3 py-1 text-xs font-semibold text-brand light:text-lime-700">
        <Clock className="h-3.5 w-3.5" />
        Información en preparación
      </span>
    </div>
  );
}

export default function CostsAndFees() {
  const [activeIndex, setActiveIndex] = useState(0);
  const tabRefs = useRef([]);
  const active = TABS[activeIndex];

  function handleKeyDown(event) {
    const moves = { ArrowRight: 1, ArrowLeft: -1 };
    if (!(event.key in moves)) return;
    event.preventDefault();
    const next = (activeIndex + moves[event.key] + TABS.length) % TABS.length;
    setActiveIndex(next);
    tabRefs.current[next]?.focus();
  }

  return (
    <div className="flex flex-col">
      <section className="mx-auto w-full max-w-7xl px-4 pb-16 pt-10 sm:px-6">
        <div className="mx-auto mb-8 max-w-xl text-center">
          <h1 className="text-2xl font-bold text-white light:text-slate-900 sm:text-3xl">Costos y comisiones</h1>
          <p className="mt-2 text-sm text-slate-400 light:text-slate-500">
            Todo lo que se cobra en Smarticket, explicado de forma clara.
          </p>
        </div>

        {/* Mismo estilo de pestañas que /como-funciona (HowItWorksAudienceCard). */}
        <div
          role="tablist"
          aria-label="¿Para quién es?"
          onKeyDown={handleKeyDown}
          className="mx-auto flex w-full max-w-md gap-1 rounded-full border border-white/10 bg-black/30 p-1"
        >
          {TABS.map((tab, index) => {
            const selected = index === activeIndex;
            return (
              <button
                key={tab.key}
                ref={(node) => (tabRefs.current[index] = node)}
                type="button"
                role="tab"
                id={`costs-tab-${tab.key}`}
                aria-selected={selected}
                aria-controls={`costs-panel-${tab.key}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActiveIndex(index)}
                className={`flex-auto whitespace-nowrap rounded-full px-2 py-2 text-center text-xs font-semibold leading-tight transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand sm:px-3 sm:text-sm ${
                  selected ? "bg-brand text-slate-950" : "text-slate-400 hover:text-white"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div
          role="tabpanel"
          id={`costs-panel-${active.key}`}
          aria-labelledby={`costs-tab-${active.key}`}
          className="mt-10"
        >
          <PendingPanel icon={active.icon} title={active.title} description={active.description} />
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-6 pb-20 text-center">
        <p className="text-sm text-slate-400 light:text-slate-500">
          ¿Tenés dudas mientras tanto? Mirá{" "}
          <Link to="/como-funciona" className="font-semibold text-brand hover:text-brand-soft">
            cómo funciona Smarticket
          </Link>{" "}
          o escribinos.
        </p>
        <a
          href="mailto:hola@pasecultural.com"
          className="mt-6 inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-brand-hover px-6 text-base font-medium text-slate-950 transition-colors duration-150 hover:bg-brand"
        >
          <Mail className="h-4 w-4" />
          Contactanos
        </a>
      </section>
    </div>
  );
}
