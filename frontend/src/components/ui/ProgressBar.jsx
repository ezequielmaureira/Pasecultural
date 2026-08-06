// Barra de ocupación/progreso genérica — no existía ningún componente de
// este tipo en todo el repo (la ocupación se mostraba siempre como texto
// "X/Y" en las pantallas de Scanner). Pensado para reutilizarse con
// capacidad por evento (Iteración 0) y por función (Iteración 1) sin cambiar
// su API base.
//
// Si no hay capacidad real (`max` nulo o 0) NUNCA se dibuja una barra al 0%:
// eso sería mostrar un dato inventado. Se muestra "Sin datos de capacidad" en
// su lugar.
//
// `secondaryValue` (Iteración 1, opcional, retrocompatible): agrega un
// segundo relleno superpuesto dentro del mismo track — pensado para
// "vendidas" (relleno primario) vs "ingresadas" (relleno secundario), ambos
// contra la misma capacidad. Sin `secondaryValue` se comporta exactamente
// igual que antes (EventHeroCard/EventStatusCard no lo usan y no cambian).
const TONE_BAR_CLASSES = {
  brand: "bg-violet-500",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-rose-500",
};

export default function ProgressBar({
  value,
  max,
  secondaryValue,
  tone = "brand",
  secondaryTone = "success",
  showLabel = true,
  size = "md",
}) {
  const hasData = typeof max === "number" && max > 0 && typeof value === "number";
  const pct = hasData ? Math.min(100, Math.max(0, Math.round((value / max) * 100))) : null;
  const hasSecondary = hasData && typeof secondaryValue === "number";
  const secondaryPct = hasSecondary ? Math.min(100, Math.max(0, Math.round((secondaryValue / max) * 100))) : null;
  const heightClass = size === "sm" ? "h-1.5" : "h-2";

  return (
    <div>
      {showLabel && (
        <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
          <span>{hasData ? `${value} / ${max}` : "Sin datos de capacidad"}</span>
          {hasData && <span className="font-medium text-slate-300">{pct}%</span>}
        </div>
      )}
      <div className={`relative w-full overflow-hidden rounded-full bg-white/10 ${heightClass}`}>
        <div
          className={`h-full rounded-full transition-[width] ${TONE_BAR_CLASSES[tone] ?? TONE_BAR_CLASSES.brand}`}
          style={{ width: hasData ? `${pct}%` : "0%" }}
        />
        {hasSecondary && (
          <div
            className={`absolute inset-y-0 left-0 rounded-full transition-[width] ${
              TONE_BAR_CLASSES[secondaryTone] ?? TONE_BAR_CLASSES.success
            }`}
            style={{ width: `${secondaryPct}%` }}
          />
        )}
      </div>
    </div>
  );
}
