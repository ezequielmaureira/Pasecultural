import { Zap, Link2, ImageIcon, Ticket as TicketIcon, VolumeX } from "lucide-react";
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
      className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-[170px_1fr] sm:items-center sm:gap-5 sm:p-5 lg:grid-cols-[220px_1fr] lg:gap-8 lg:p-6"
    >
      {/* Mockup ilustrativo — mismo lenguaje visual que el screen "preview"
          real (fondo oscuro, gradiente, CTA en degradé), pero estático y
          sin datos del organizador. Referencia visual: mockup vertical con
          marco tipo teléfono, apoyado a la izquierda de la card, ocupando
          una columna angosta y fija (nunca crece para "llenar" la card). */}
      <div className="mx-auto w-full max-w-[150px] shrink-0 rounded-[26px] border border-white/10 bg-black/40 p-1.5 shadow-[0_0_24px_rgba(168,85,247,0.25)] sm:max-w-[170px] lg:max-w-[220px]">
        <div className="relative aspect-[9/18] w-full overflow-hidden rounded-[20px] bg-gradient-to-br from-violet-950 via-slate-950 to-black">
          <div className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-black/50 text-white/70 lg:h-6 lg:w-6">
            <VolumeX className="h-2.5 w-2.5 lg:h-3 lg:w-3" />
          </div>
          <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1.5 bg-gradient-to-t from-black via-black/80 to-transparent p-2.5 pt-8 lg:gap-2 lg:p-3 lg:pt-10">
            <span className="w-fit rounded-full bg-violet-500/20 px-1.5 py-0.5 text-[7px] font-semibold uppercase tracking-wide text-violet-200 lg:text-[9px]">
              Smarticket · Fest Pass
            </span>
            <p className="text-xs font-bold leading-tight text-white lg:text-base">Fest</p>
            <p className="text-[9px] leading-tight text-white/60 lg:text-[11px]">
              29 de sept de 2026, 08:00 p.m.
              <br />
              San Martín 850 · General Roca
            </p>
            <div className="flex items-center justify-between border-t border-white/10 pt-1.5 text-[9px] lg:text-[11px]">
              <span className="text-white/50">
                Elegí tus entradas
                <br />
                <span className="text-white/80">VIP</span>
              </span>
              <span className="font-semibold text-white">$6.000</span>
            </div>
            <button
              type="button"
              tabIndex={-1}
              aria-hidden="true"
              className="mt-0.5 flex items-center justify-center gap-1 rounded-full bg-gradient-to-r from-fuchsia-500 via-violet-500 to-blue-500 py-1.5 text-[9px] font-bold text-white lg:py-2 lg:text-[11px]"
            >
              <TicketIcon className="h-2.5 w-2.5 lg:h-3 lg:w-3" />
              Comprar entradas
            </button>
            <button
              type="button"
              tabIndex={-1}
              aria-hidden="true"
              className="flex items-center justify-center rounded-full border border-white/15 py-1.5 text-[8px] font-medium text-white/70 lg:py-1.5 lg:text-[10px]"
            >
              Ver detalle del evento
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="flex items-center gap-1.5 text-base font-bold text-white lg:text-lg">
            <Zap className="h-4 w-4 text-violet-400" />
            ¿Qué es Fest Pass?
          </h2>
          <p className="text-xs text-slate-300 lg:text-sm">
            Una experiencia distinta para vender tu evento con una página rápida, visual y lista para compartir.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          {BENEFITS.map(({ icon: Icon, title, subtitle }) => (
            <div
              key={title}
              className="flex items-start gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] p-2.5 lg:p-3"
            >
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-300">
                <Icon className="h-3.5 w-3.5" />
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
