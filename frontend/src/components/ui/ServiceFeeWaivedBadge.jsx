import { BadgeCheck } from "lucide-react";

// "SIN CARGO DE SERVICIO" para el comprador. Se muestra SÓLO cuando el
// backend mandó serviceFeeWaived === true (GET /api/events/public/:slug,
// calculado con isServiceFeeWaived). Nunca se infiere de fechas, de la
// organización ni de la configuración global: el backend es la fuente de
// verdad y el cobro real lo decide createSaleForBuyer. No explica por qué
// ni hasta cuándo — al comprador sólo le importa que no hay cargo.
export function isServiceFeeWaivedEvent(event) {
  return event?.serviceFeeWaived === true;
}

const SIZES = {
  xs: "gap-1 px-2 py-0.5 text-[10px]",
  sm: "gap-1.5 px-2.5 py-1 text-[11px]",
};

export default function ServiceFeeWaivedBadge({ size = "sm", className = "" }) {
  return (
    <span
      className={`inline-flex max-w-full items-center rounded-full border border-brand/40 bg-brand/10 font-bold uppercase leading-tight tracking-wide text-brand light:border-lime-600/40 light:bg-lime-500/10 light:text-lime-700 ${SIZES[size]} ${className}`}
    >
      <BadgeCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">Sin cargo de servicio</span>
    </span>
  );
}
