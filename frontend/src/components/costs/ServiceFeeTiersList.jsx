import { formatCurrencyARS } from "../../lib/format.js";

// Escala de cargos fijos por entrada, tal cual la devuelve
// GET /api/sales/service-fee-tiers (la misma configuración que usa el
// checkout — ver lib/serviceFeeApi.js). Nunca hay montos escritos acá:
// si la escala cambia desde Developer > Configuración, esta lista cambia
// sola.
//
// Cada tramo incluye su límite inferior y excluye el superior (mismo
// criterio que calculateServiceFeeForUnitPrice), por eso se muestra como
// "Desde $X": el tramo siguiente marca dónde termina.
export default function ServiceFeeTiersList({ tiers, status }) {
  if (status === "loading") {
    return (
      <div className="space-y-2" aria-hidden="true">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-12 animate-pulse rounded-xl bg-white/5" />
        ))}
      </div>
    );
  }

  if (status === "error" || !tiers?.length) {
    return (
      <p className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-400 light:border-slate-200 light:bg-white light:text-slate-500">
        No pudimos cargar la escala de cargos en este momento. Probá de nuevo en unos minutos.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-white/5 overflow-hidden rounded-xl border border-white/10 bg-black/20 light:divide-slate-200 light:border-slate-200 light:bg-white">
      <li className="flex items-center justify-between gap-3 px-4 py-3">
        <span className="text-sm text-slate-300 light:text-slate-600">Entradas gratuitas</span>
        <span className="shrink-0 text-sm font-semibold text-brand light:text-lime-700">Sin cargo</span>
      </li>
      {tiers.map((tier) => (
        <li key={tier.minAmount} className="flex items-center justify-between gap-3 px-4 py-3">
          <span className="min-w-0 text-sm text-slate-300 light:text-slate-600">
            {tier.minAmount > 0
              ? `Desde ${formatCurrencyARS(tier.minAmount)}`
              : tier.maxAmount != null
                ? `Menos de ${formatCurrencyARS(tier.maxAmount)}`
                : "Entradas pagas"}
          </span>
          <span className="shrink-0 text-sm font-semibold text-white light:text-slate-900">
            {formatCurrencyARS(tier.feeAmount)} <span className="font-normal text-slate-400">por entrada</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
