import { Zap, Link2, ImageIcon, Ticket as TicketIcon } from "lucide-react";
import Card from "../ui/Card.jsx";

// Bloque explicativo mostrado ÚNICA Y EXCLUSIVAMENTE arriba del formulario
// de creación (FestPass.jsx, screen === "info") — nunca en tickets/preview/
// success, y nunca reemplaza ese formulario. Reusa Card variant="glass" tal
// cual ya existe (mismo glow violeta que ya usa QuickPass.jsx) en vez de
// inventar una superficie nueva. El mini-mockup de la derecha es puramente
// ilustrativo (texto fijo "Fest", sin datos reales ni navegación) — la
// vista previa REAL con los datos que carga el organizador ya vive más
// adelante, en el screen "preview" de FestPass.jsx; acá sólo se busca que
// se entienda de un vistazo qué es Fest Pass antes de completar nada.
const BENEFITS = [
  {
    icon: Zap,
    title: "Creá rápido",
    subtitle: "Publicá tu evento en minutos y sin complicaciones.",
  },
  {
    icon: Link2,
    title: "Generá una URL para pegar en tu perfil de redes",
    subtitle: "Compartila donde quieras.",
  },
  {
    icon: ImageIcon,
    title: "Mostrá mejor tu evento con imagen y video",
    subtitle: "Impactá desde el primer vistazo.",
  },
];

export default function FestPassIntro() {
  return (
    <Card
      variant="glass"
      className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-[140px_1fr] sm:items-center sm:gap-5 sm:p-5 lg:grid-cols-[200px_1fr] lg:gap-6 lg:p-6"
    >
      {/* Mini mockup ilustrativo — mismo lenguaje visual que el screen
          "preview" real (fondo oscuro, gradiente, CTA en degradé), pero
          estático y sin datos del organizador. Deliberadamente CHICO en
          todos los breakpoints (miniatura, nunca protagonista): 130px en
          mobile, hasta 200px en desktop — nunca crece para "llenar" la
          card. */}
      <div className="mx-auto w-full max-w-[130px] shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black shadow-[0_0_18px_rgba(168,85,247,0.2)] sm:max-w-[140px] lg:max-w-[200px]">
        <div className="relative aspect-[9/16] w-full bg-gradient-to-br from-violet-950 via-slate-950 to-black">
          <div className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-white/10 text-white/70 lg:h-5 lg:w-5">
            <ImageIcon className="h-2.5 w-2.5 lg:h-3 lg:w-3" />
          </div>
          <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1 p-2 lg:gap-1.5 lg:p-3">
            <span className="w-fit rounded-full bg-violet-500/20 px-1.5 py-0.5 text-[7px] font-semibold uppercase tracking-wide text-violet-200 lg:text-[9px]">
              Fest Pass
            </span>
            <p className="text-[11px] font-bold leading-tight text-white lg:text-sm">Fest</p>
            <p className="hidden text-[10px] text-white/60 lg:block">29 de sept, 20:00hs · San Martín 850</p>
            <button
              type="button"
              tabIndex={-1}
              aria-hidden="true"
              className="mt-0.5 flex items-center justify-center gap-1 rounded-full bg-gradient-to-r from-fuchsia-500 via-violet-500 to-blue-500 py-1 text-[8px] font-bold text-white lg:py-2 lg:text-[11px]"
            >
              <TicketIcon className="h-2 w-2 lg:h-3 lg:w-3" />
              Comprar entradas
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2.5 lg:gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-white lg:text-base">
            <Zap className="h-3.5 w-3.5 text-violet-400 lg:h-4 lg:w-4" />
            ¿Qué es Fest Pass?
          </h2>
          <p className="text-xs text-slate-300 lg:text-sm">
            Una experiencia distinta para vender tu evento con una página rápida, visual y lista para compartir.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          {BENEFITS.map(({ icon: Icon, title, subtitle }) => (
            <div key={title} className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-300">
                <Icon className="h-3 w-3" />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-medium leading-tight text-white lg:text-sm">{title}</p>
                <p className="text-[11px] text-slate-400 lg:text-xs">{subtitle}</p>
              </div>
            </div>
          ))}
        </div>

        <p className="text-[11px] italic text-slate-500 lg:text-xs">Ideal para bio, historias y difusión.</p>
      </div>
    </Card>
  );
}
