import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Mail } from "lucide-react";
import FeeSimulator from "../components/costs/FeeSimulator.jsx";
import ServiceFeeTiersList from "../components/costs/ServiceFeeTiersList.jsx";
import { getPublicServiceFeeConfig } from "../lib/serviceFeeApi.js";
import { formatMonthsInWords } from "../lib/serviceFeeWaiver.js";

// Página pública "Costos y comisiones". Esquema comercial:
// - el organizador nunca paga comisión Smarticket ($0, sin porcentajes);
// - el comprador paga un cargo de servicio FIJO por entrada según su
//   precio, salvo mientras el organizador tenga el beneficio para
//   compradores activo: N meses desde que publica su primer evento,
//   extendible a mano desde Developer (nunca automático). Ver
//   backend/src/services/serviceFeeWaiver.service.js.
// La escala y N (serviceFeeWaiverDurationMonths) salen de
// GET /api/sales/service-fee-tiers — la misma configuración de Developer >
// Configuración que aplica el checkout. Nunca hay montos ni duraciones
// escritos acá. Con N = 0 (o si no se pudo leer) no se menciona ninguna
// promoción inicial. La pestaña de asistentes NO habla del beneficio (ni
// meses ni renovaciones): el comprador lo ve en cada evento que lo tiene
// ("SIN CARGO DE SERVICIO", sólo con serviceFeeWaived === true).
const TABS = [
  { key: "attendees", label: "Para asistentes" },
  { key: "organizers", label: "Para organizadores" },
];

const PAYMENT_METHOD_NOTE =
  "Los costos propios del medio de pago, cuando correspondan, son independientes de los cargos de servicio de Smarticket.";

function Highlight({ children }) {
  return (
    <div className="rounded-2xl border border-brand/40 bg-brand/10 p-5 shadow-[0_0_30px_-12px_rgba(182,255,46,0.45)] sm:p-6">
      {children}
    </div>
  );
}

function TiersBlock({ tiers, tiersStatus, intro }) {
  return (
    <div>
      <p className="text-sm text-slate-300 light:text-slate-600">{intro}</p>
      <h3 className="mb-3 mt-5 text-sm font-semibold uppercase tracking-wide text-slate-400 light:text-slate-500">
        Cargo de servicio por entrada
      </h3>
      <ServiceFeeTiersList tiers={tiers} status={tiersStatus} />
    </div>
  );
}

function AttendeesPanel({ tiers, tiersStatus }) {
  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start lg:gap-10">
      <div className="min-w-0 space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-white light:text-slate-900 sm:text-3xl">
            Sabé cuánto vas a pagar antes de comprar
          </h2>
          <p className="mt-3 text-sm text-slate-300 light:text-slate-600 sm:text-base">
            Smarticket no usa porcentajes sobre el valor de tu entrada. Cuando corresponde un cargo de servicio,
            utilizamos importes fijos según el precio de la entrada.
          </p>
        </div>

        <TiersBlock
          tiers={tiers}
          tiersStatus={tiersStatus}
          intro="El cargo final siempre se muestra antes de confirmar la compra."
        />
      </div>

      <div className="min-w-0 lg:sticky lg:top-24">
        <FeeSimulator audience="attendee" tiers={tiers} tiersStatus={tiersStatus} />
      </div>
    </div>
  );
}

function OrganizersPanel({ tiers, tiersStatus, waiverMonths }) {
  const hasInitialBenefit = waiverMonths > 0;
  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start lg:gap-10">
      <div className="min-w-0 space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-white light:text-slate-900 sm:text-3xl">
            Vos vendés. Smarticket no se queda con un porcentaje.
          </h2>
          <div className="mt-5 flex items-center gap-4">
            <p className="shrink-0 text-5xl font-extrabold text-brand light:text-lime-700 sm:text-6xl">$0</p>
            <p className="text-base font-semibold leading-snug text-white light:text-slate-900 sm:text-lg">
              de comisión Smarticket para organizadores
            </p>
          </div>
          <p className="mt-4 text-sm text-slate-300 light:text-slate-600 sm:text-base">
            Smarticket no descuenta una comisión porcentual sobre el valor de tus entradas.
          </p>
        </div>

        {hasInitialBenefit && (
          <Highlight>
            <h3 className="text-lg font-bold text-white light:text-slate-900 sm:text-xl">
              <span aria-hidden="true">🎉 </span>
              {waiverMonths === 1 ? "Tu primer mes" : `Tus primeros ${waiverMonths} meses`}
            </h3>
            <p className="mt-2 text-sm text-slate-300 light:text-slate-600 sm:text-base">
              Actualmente, las organizaciones que publican su primer evento reciben inicialmente{" "}
              {formatMonthsInWords(waiverMonths)} sin cargo de servicio Smarticket para sus compradores.
            </p>
            <p className="mt-4 text-base font-bold text-brand light:text-lime-700 sm:text-lg">Vos pagás $0.</p>
            <p className="mt-3 text-xs text-slate-400 light:text-slate-500">Los beneficios promocionales pueden extenderse.</p>
          </Highlight>
        )}

        <TiersBlock
          tiers={tiers}
          tiersStatus={tiersStatus}
          intro={
            hasInitialBenefit
              ? "Cuando termina el beneficio, vos seguís pagando $0 de comisión Smarticket. El comprador comienza a pagar el cargo fijo correspondiente según el valor de la entrada."
              : "Vos pagás $0 de comisión Smarticket. Cuando corresponde, el comprador paga un cargo fijo según el valor de la entrada."
          }
        />

        <p className="text-base font-semibold text-white light:text-slate-900">
          Sin porcentajes. Sin castigar las entradas de mayor valor.
        </p>
      </div>

      <div className="min-w-0 lg:sticky lg:top-24">
        <FeeSimulator audience="organizer" tiers={tiers} tiersStatus={tiersStatus} />
      </div>
    </div>
  );
}

export default function CostsAndFees() {
  const [activeIndex, setActiveIndex] = useState(0);
  const tabRefs = useRef([]);
  const active = TABS[activeIndex];
  const [tiers, setTiers] = useState(null);
  const [tiersStatus, setTiersStatus] = useState("loading"); // "loading" | "ready" | "error"
  // Duración del beneficio inicial (Developer > Configuración). null
  // mientras carga o si falló: no se promete ninguna promoción.
  const [waiverMonths, setWaiverMonths] = useState(null);

  // Una sola carga para las dos pestañas y sus simuladores.
  useEffect(() => {
    let cancelled = false;
    getPublicServiceFeeConfig()
      .then(({ tiers: list, serviceFeeWaiverDurationMonths }) => {
        if (cancelled) return;
        setTiers(list);
        setTiersStatus(list?.length ? "ready" : "error");
        setWaiverMonths(serviceFeeWaiverDurationMonths);
      })
      .catch((err) => {
        console.error("No se pudo cargar la escala de cargos de servicio", err);
        if (!cancelled) setTiersStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleKeyDown(event) {
    const moves = { ArrowRight: 1, ArrowLeft: -1 };
    if (!(event.key in moves)) return;
    event.preventDefault();
    const next = (activeIndex + moves[event.key] + TABS.length) % TABS.length;
    setActiveIndex(next);
    tabRefs.current[next]?.focus();
  }

  const Panel = active.key === "attendees" ? AttendeesPanel : OrganizersPanel;

  return (
    <div className="flex flex-col">
      <section className="mx-auto w-full max-w-6xl px-4 pb-12 pt-10 sm:px-6">
        <div className="mx-auto mb-8 max-w-xl text-center">
          <h1 className="text-2xl font-bold text-white light:text-slate-900 sm:text-3xl">Costos y comisiones</h1>
          <p className="mt-2 text-sm text-slate-400 light:text-slate-500">
            Cuánto cuesta usar Smarticket, explicado en segundos.
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
          <Panel tiers={tiers} tiersStatus={tiersStatus} waiverMonths={waiverMonths} />
        </div>

        <p className="mx-auto mt-10 max-w-2xl text-center text-xs text-slate-500">{PAYMENT_METHOD_NOTE}</p>
      </section>

      <section className="mx-auto max-w-3xl px-6 pb-20 text-center">
        <p className="text-sm text-slate-400 light:text-slate-500">
          ¿Tenés dudas? Mirá{" "}
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
