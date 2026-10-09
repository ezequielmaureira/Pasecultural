import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Mail } from "lucide-react";
import FeeSimulator from "../components/costs/FeeSimulator.jsx";
import ServiceFeeTiersList from "../components/costs/ServiceFeeTiersList.jsx";
import { getPublicServiceFeeConfig } from "../lib/serviceFeeApi.js";
import { formatMonthsInWords } from "../lib/serviceFeeWaiver.js";

// Página pública "Costos y comisiones", dirigida SOLO a organizadores (el
// comprador ve precio, cargo, total y "SIN CARGO DE SERVICIO" durante la
// compra; no tiene una página propia). Esquema comercial:
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
// promoción inicial.
const PAYMENT_METHOD_NOTE =
  "Los costos propios del medio de pago, cuando correspondan, son independientes de los cargos de servicio de Smarticket.";

function Highlight({ children }) {
  return (
    <div className="rounded-2xl border border-brand/40 bg-brand/10 p-5 shadow-[0_0_30px_-12px_rgba(182,255,46,0.45)] sm:p-6">
      {children}
    </div>
  );
}

function OrganizersContent({ tiers, tiersStatus, waiverMonths }) {
  const hasInitialBenefit = waiverMonths > 0;
  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start lg:gap-10">
      <div className="min-w-0 space-y-6">
        <div>
          <div className="flex items-center gap-4">
            <p className="shrink-0 text-5xl font-extrabold text-brand light:text-lime-700 sm:text-6xl">$0</p>
            <h2 className="text-lg font-bold leading-snug text-white light:text-slate-900 sm:text-2xl">
              de comisión Smarticket para organizadores
            </h2>
          </div>
          <p className="mt-4 text-sm text-slate-300 light:text-slate-600 sm:text-base">
            Smarticket no se queda con un porcentaje de tus entradas.
          </p>
        </div>

        {hasInitialBenefit && (
          <Highlight>
            <h3 className="text-lg font-bold text-white light:text-slate-900 sm:text-xl">
              <span aria-hidden="true">🎉 </span>
              {waiverMonths === 1 ? "Tu primer mes" : `Tus primeros ${waiverMonths} meses`}
            </h3>
            <p className="mt-2 text-sm text-slate-300 light:text-slate-600 sm:text-base">
              Desde que publicás tu primer evento, durante {formatMonthsInWords(waiverMonths)} tus compradores pagan
              $0 de cargo de servicio Smarticket.
            </p>
            <p className="mt-3 text-xs text-slate-400 light:text-slate-500">Los beneficios promocionales pueden extenderse.</p>
          </Highlight>
        )}

        <p className="text-sm text-slate-300 light:text-slate-600 sm:text-base">
          {hasInitialBenefit
            ? "Cuando termina el beneficio, vos seguís pagando $0 de comisión Smarticket. El comprador paga el cargo fijo correspondiente según el valor de la entrada."
            : "Vos pagás $0 de comisión Smarticket. El comprador paga un cargo fijo según el valor de la entrada."}
        </p>

        <p className="text-base font-semibold text-white light:text-slate-900">
          Sin porcentajes. Sin castigar las entradas de mayor valor.
        </p>

        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400 light:text-slate-500">
            Cargo de servicio por entrada
          </h3>
          <p className="mb-3 mt-2 text-sm text-slate-300 light:text-slate-600">
            Estos son los cargos que puede pagar tu comprador cuando no existe una promoción aplicable.
          </p>
          <ServiceFeeTiersList tiers={tiers} status={tiersStatus} />
        </div>
      </div>

      <div className="min-w-0 lg:sticky lg:top-24">
        <FeeSimulator tiers={tiers} tiersStatus={tiersStatus} />
      </div>
    </div>
  );
}

export default function CostsAndFees() {
  const [tiers, setTiers] = useState(null);
  const [tiersStatus, setTiersStatus] = useState("loading"); // "loading" | "ready" | "error"
  // Duración del beneficio inicial (Developer > Configuración). null
  // mientras carga o si falló: no se promete ninguna promoción.
  const [waiverMonths, setWaiverMonths] = useState(null);

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

  return (
    <div className="flex flex-col">
      <section className="mx-auto w-full max-w-6xl px-4 pb-12 pt-10 sm:px-6">
        <div className="mx-auto mb-10 max-w-xl text-center">
          <h1 className="text-2xl font-bold text-white light:text-slate-900 sm:text-3xl">Costos y comisiones</h1>
          <p className="mt-2 text-sm text-slate-400 light:text-slate-500">
            Para organizadores: cuánto cuesta vender con Smarticket.
          </p>
        </div>

        <OrganizersContent tiers={tiers} tiersStatus={tiersStatus} waiverMonths={waiverMonths} />

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
