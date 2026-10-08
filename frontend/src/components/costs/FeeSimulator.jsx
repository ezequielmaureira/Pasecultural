import { useId, useState } from "react";
import { X } from "lucide-react";
import { formatCurrencyARS } from "../../lib/format.js";
import { formatPriceInput, sanitizePriceInput, simulatePurchase } from "../../lib/feeSimulation.js";

// Textos por audiencia: la cuenta es la misma (lib/feeSimulation.js), sólo
// cambia cómo se cuenta. "organizer" agrega la fila de comisión al
// organizador, que siempre es $0.
const COPY = {
  attendee: {
    title: "Simulá tu compra",
    question: "¿El organizador tiene beneficio activo?",
    options: ["Sí", "No"],
    totalLabel: "Total a pagar",
    priceLabel: "Entrada",
    feeLabel: "Cargo Smarticket",
    promoNote: "Con el beneficio activo del organizador, no pagás cargo de servicio Smarticket.",
    afterNote: "Cargo fijo según el valor de la entrada. Sin porcentajes.",
  },
  organizer: {
    title: "Simulá cómo lo verá tu comprador",
    question: "Beneficio para compradores",
    options: ["Activo", "Sin beneficio"],
    totalLabel: "Tu comprador paga",
    priceLabel: "Precio entrada",
    feeLabel: "Cargo Smarticket al comprador",
    promoNote: "Smarticket no descuenta comisión al organizador.",
    afterNote: "Smarticket no descuenta comisión al organizador. El comprador paga un cargo fijo según el valor de la entrada.",
  },
};

function Row({ label, value, strong = false, accent = false }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <dt className="min-w-0 text-sm text-slate-400 light:text-slate-500">{label}</dt>
      <dd
        className={`shrink-0 text-right tabular-nums ${strong ? "text-base font-bold" : "text-sm font-semibold"} ${
          accent ? "text-brand light:text-lime-700" : "text-white light:text-slate-900"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

// El selector "¿beneficio activo?" se muestra SIEMPRE, aunque la promoción
// inicial esté en 0 en Developer > Configuración: una organización puede
// tener un beneficio vigente anterior u otorgado a mano.
export default function FeeSimulator({ audience = "attendee", tiers, tiersStatus }) {
  const copy = COPY[audience];
  const inputId = useId();
  const [digits, setDigits] = useState("");
  const [benefitActive, setBenefitActive] = useState(true);

  const result = simulatePurchase({ digits, benefitActive, tiers: tiersStatus === "ready" ? tiers : null });
  const loadingFee = result && !benefitActive && result.price > 0 && tiersStatus === "loading";
  const money = (value) => (value == null ? "—" : formatCurrencyARS(value));
  const totalText = !result || loadingFee ? "—" : result.feeAvailable ? money(result.total) : "—";

  return (
    <section
      aria-labelledby={`${inputId}-title`}
      className="smarticket-neon-surface rounded-2xl p-4 sm:p-6"
    >
      <h3 id={`${inputId}-title`} className="text-lg font-bold text-white light:text-slate-900 sm:text-xl">
        {copy.title}
      </h3>

      <label htmlFor={inputId} className="mt-4 block text-sm font-medium text-slate-300 light:text-slate-600">
        Precio de la entrada
      </label>
      <div className="mt-1.5 flex h-14 items-center gap-2 rounded-xl border border-white/15 bg-black/30 px-4 transition-colors duration-150 focus-within:border-brand light:border-slate-300 light:bg-white">
        <span className="text-lg font-semibold text-slate-400" aria-hidden="true">$</span>
        <input
          id={inputId}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="0"
          value={formatPriceInput(digits)}
          onChange={(event) => setDigits(sanitizePriceInput(event.target.value))}
          className="h-full min-w-0 flex-1 bg-transparent text-lg font-semibold text-white tabular-nums outline-none placeholder:text-slate-600 light:text-slate-900"
        />
        {digits !== "" && (
          <button
            type="button"
            onClick={() => setDigits("")}
            className="flex h-9 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-slate-400 transition-colors duration-150 hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand light:hover:bg-slate-900/5 light:hover:text-slate-900"
          >
            <X className="h-4 w-4" />
            Limpiar
          </button>
        )}
      </div>

      <p id={`${inputId}-benefit`} className="mt-4 text-sm font-medium text-slate-300 light:text-slate-600">
        {copy.question}
      </p>
      <div
        role="radiogroup"
        aria-labelledby={`${inputId}-benefit`}
        className="mt-1.5 grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-black/30 p-1 light:border-slate-200 light:bg-slate-100"
      >
        {copy.options.map((label, index) => {
          const value = index === 0;
          const selected = benefitActive === value;
          return (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setBenefitActive(value)}
              className={`min-h-11 rounded-lg px-2 py-2 text-sm font-semibold leading-tight transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                selected ? "bg-brand text-slate-950" : "text-slate-400 hover:text-white light:text-slate-500 light:hover:text-slate-900"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div aria-live="polite" className="mt-5 rounded-xl border border-white/10 bg-black/30 p-4 light:border-slate-200 light:bg-white sm:p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 light:text-slate-500">{copy.totalLabel}</p>
        <p
          className={`mt-1 font-extrabold leading-tight text-white tabular-nums light:text-slate-900 ${
            totalText.length > 12 ? "text-2xl [overflow-wrap:anywhere] min-[360px]:text-3xl" : "text-4xl sm:text-5xl"
          }`}
        >
          {totalText}
        </p>

        {!result && <p className="mt-2 text-sm text-slate-400 light:text-slate-500">Ingresá un precio para ver el resultado.</p>}

        {result && benefitActive && result.price > 0 && (
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-brand/40 bg-brand/10 px-3 py-1 text-xs font-semibold text-brand light:text-lime-700">
            <span aria-hidden="true">🎉</span> Sin cargo de servicio Smarticket
          </p>
        )}
        {result?.isFree && (
          <p className="mt-3 text-sm text-slate-400 light:text-slate-500">Entrada gratuita: sin cargo de servicio.</p>
        )}
        {result && !result.feeAvailable && !loadingFee && (
          <p className="mt-3 text-sm text-slate-400 light:text-slate-500">
            No pudimos cargar la escala de cargos en este momento. Probá de nuevo en unos minutos.
          </p>
        )}

        <dl className="mt-4 divide-y divide-white/5 border-t border-white/10 light:divide-slate-200 light:border-slate-200">
          <Row label={copy.priceLabel} value={result ? money(result.price) : "—"} />
          {audience === "organizer" && (
            <Row label="Comisión Smarticket al organizador" value={formatCurrencyARS(0)} accent />
          )}
          <Row
            label={copy.feeLabel}
            value={!result || loadingFee ? "—" : result.feeAvailable ? money(result.serviceFee) : "No disponible"}
            accent={result?.serviceFee === 0}
          />
          <Row label={audience === "organizer" ? "Total comprador" : "Total"} value={totalText} strong />
        </dl>

        {result && result.price > 0 && (
          <p className="mt-3 text-xs text-slate-400 light:text-slate-500">{benefitActive ? copy.promoNote : copy.afterNote}</p>
        )}
      </div>
    </section>
  );
}
