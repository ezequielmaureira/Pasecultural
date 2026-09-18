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
      className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_1fr] lg:items-center lg:gap-8"
    >
      {/* Mini mockup ilustrativo — mismo lenguaje visual que el screen
          "preview" real (fondo oscuro, gradiente, CTA en degradé), pero
          estático y sin datos del organizador. */}
      <div className="mx-auto w-full max-w-[220px] overflow-hidden rounded-2xl border border-white/10 bg-black shadow-[0_0_30px_rgba(168,85,247,0.25)]">
        <div className="relative aspect-[9/16] w-full bg-gradient-to-br from-violet-950 via-slate-950 to-black">
          <div className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-white/70">
            <ImageIcon className="h-3.5 w-3.5" />
          </div>
          <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1.5 p-3">
            <span className="w-fit rounded-full bg-violet-500/20 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-violet-200">
              Smarticket · Fest Pass
            </span>
            <p className="text-sm font-bold leading-tight text-white">Fest</p>
            <p className="text-[10px] text-white/60">29 de sept, 20:00hs · San Martín 850</p>
            <button
              type="button"
              tabIndex={-1}
              aria-hidden="true"
              className="mt-1 flex items-center justify-center gap-1.5 rounded-full bg-gradient-to-r from-fuchsia-500 via-violet-500 to-blue-500 py-2 text-[11px] font-bold text-white"
            >
              <TicketIcon className="h-3 w-3" />
              Comprar entradas
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <h2 className="flex items-center gap-2 text-base font-bold text-white">
            <Zap className="h-4 w-4 text-violet-400" />
            ¿Qué es Fest Pass?
          </h2>
          <p className="text-sm text-slate-300">
            Una experiencia distinta para vender tu evento con una página rápida, visual y lista para compartir.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          {BENEFITS.map(({ icon: Icon, title, subtitle }) => (
            <div key={title} className="flex items-start gap-3">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-300">
                <Icon className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium leading-tight text-white">{title}</p>
                <p className="text-xs text-slate-400">{subtitle}</p>
              </div>
            </div>
          ))}
        </div>

        <p className="text-xs italic text-slate-500">Ideal para bio, historias y difusión.</p>
      </div>
    </Card>
  );
}
