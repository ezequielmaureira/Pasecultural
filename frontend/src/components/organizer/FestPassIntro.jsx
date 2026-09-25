import { Zap, Link2, ImageIcon, Ticket as TicketIcon, VolumeX, Share2 } from "lucide-react";
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
      {/* Mockup ilustrativo — réplica en miniatura de la pantalla REAL del
          comprador (mismo layering/clases que pages/public/QuickPass.jsx,
          fase "event": foto + overlays, FestPassBadge, card glass con
          datos+entradas, CTA degradé, botón "ver detalle" y "Compartir"),
          escalado a tamaño de preview — nunca los datos reales del
          organizador, sólo para que se entienda de un vistazo qué es. */}
      <div className="relative mx-auto aspect-[9/19] w-full max-w-[150px] shrink-0 overflow-hidden rounded-[22px] border border-white/10 bg-slate-950 shadow-[0_0_24px_rgba(190,242,100,0.25)] sm:max-w-[170px] lg:max-w-[220px]">
        {/* "Foto" simulada (sin imagen real acá) + los overlays EXACTOS
            que ya usa QuickPass.jsx sobre la imagen/video real (ver el
            informe de la ronda "nitidez del video de fondo"). */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_22%,rgba(132,204,22,0.35),transparent_60%),linear-gradient(180deg,#1e1b4b,#020617)]" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-black/5" />
        <div className="absolute inset-0 bg-brand/5" />

        <div className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white lg:right-2 lg:top-2 lg:h-5 lg:w-5">
          <VolumeX className="h-2 w-2 lg:h-2.5 lg:w-2.5" />
        </div>

        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1.5 p-2 lg:gap-2 lg:p-2.5">
          <div className="flex items-center justify-center gap-1 pb-0.5 text-center">
            <span className="text-[6px] font-bold uppercase tracking-[0.2em] text-white/80 lg:text-[7px]">
              Smarticket
            </span>
            <span className="h-[3px] w-[3px] rounded-full bg-brand" />
            <span className="text-[6px] font-bold uppercase tracking-[0.2em] text-brand lg:text-[7px]">
              Fest Pass
            </span>
          </div>

          <div className="rounded-xl border border-white/15 bg-white/14 p-2 backdrop-blur-sm lg:rounded-2xl lg:p-2.5">
            <p className="text-xs font-extrabold leading-tight text-white lg:text-sm">Fest</p>
            <p className="mt-0.5 text-[8px] leading-tight text-white/80 lg:text-[9px]">29 de sept de 2026, 08:00 p.m.</p>
            <p className="text-[8px] leading-tight text-white/70 lg:text-[9px]">San Martín 850 · General Roca</p>

            <div className="mt-1.5 flex flex-col gap-1 border-t border-white/10 pt-1.5">
              <p className="text-[6px] font-semibold uppercase tracking-wide text-white/60 lg:text-[7px]">
                Elegí tus entradas
              </p>
              <div className="flex items-center justify-between text-[8px] lg:text-[9px]">
                <span className="text-white/90">VIP</span>
                <span className="font-semibold text-white">$6.000</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            className="flex items-center justify-center gap-1 rounded-full bg-brand py-1.5 text-[8px] font-bold text-slate-950 shadow-[0_0_12px_rgba(182,255,46,0.4)] lg:text-[9px]"
          >
            <TicketIcon className="h-2.5 w-2.5" />
            Comprar entradas
          </button>
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            className="flex items-center justify-center rounded-full border border-white/25 bg-white/5 py-1.5 text-[7px] font-semibold text-white lg:text-[8px]"
          >
            Ver detalle del evento
          </button>
          <div className="flex items-center justify-center gap-1 pb-0.5 text-[7px] font-medium text-white/70 lg:text-[8px]">
            <Share2 className="h-2 w-2" />
            Compartir
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="flex items-center gap-1.5 text-base font-bold text-white lg:text-lg">
            <Zap className="h-4 w-4 text-brand" />
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
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand/15 text-brand-soft">
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
