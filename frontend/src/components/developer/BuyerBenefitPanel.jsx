import Button from "../ui/Button.jsx";
import { formatMonths, formatWaiverDate, getServiceFeeWaiverStatus } from "../../lib/serviceFeeWaiver.js";

const STATUS_STYLES = {
  NOT_STARTED: "bg-white/10 text-slate-300",
  ACTIVE: "bg-emerald-500/15 text-emerald-300",
  EXPIRED: "bg-amber-500/15 text-amber-300",
  NONE: "bg-white/10 text-slate-300",
};
const STATUS_LABEL = { NOT_STARTED: "SIN INICIAR", ACTIVE: "ACTIVO", EXPIRED: "VENCIDO", NONE: "SIN BENEFICIO" };

// Texto del botón según el estado y la duración configurada HOY en
// Developer > Configuración (la renovación usa siempre la vigente).
export function renewBenefitLabel(status, durationMonths) {
  const period = formatMonths(durationMonths);
  if (status === "ACTIVE") return `Extender beneficio ${period}`;
  if (status === "NONE") return `Otorgar beneficio por ${period}`;
  return `Renovar beneficio por ${period}`;
}

// Detalle de organización (Developer) → "Beneficio compradores". La
// renovación la confirma DeveloperOrganizations (ConfirmDialog) y el nuevo
// vencimiento lo calcula el backend con la duración configurada:
// activo → vencimiento + N meses, vencido → hoy + N meses.
// durationMonths: null mientras carga o si no se pudo leer (sin botón);
// 0 = promoción desactivada desde Configuración (sin botón).
export default function BuyerBenefitPanel({ organization, onRenew, updating, renewedUntil, durationMonths }) {
  const status = getServiceFeeWaiverStatus(organization);
  const until = organization.serviceFeeWaivedUntil;

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Beneficio compradores</p>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[status]}`}>
          {STATUS_LABEL[status]}
        </span>
      </div>

      <p className="mt-2 text-sm text-slate-200">
        {status === "NOT_STARTED" && "Comienza cuando publique su primer evento."}
        {status === "ACTIVE" && `Sin cargo Smarticket para compradores hasta ${formatWaiverDate(until)}`}
        {status === "EXPIRED" && `Beneficio finalizado el ${formatWaiverDate(until)}`}
        {status === "NONE" && "Publicó con el beneficio inicial desactivado: sus compradores pagan los cargos fijos."}
      </p>
      {organization.firstEventPublishedAt && (
        <p className="mt-1 text-xs text-slate-500">
          Primer evento publicado: {formatWaiverDate(organization.firstEventPublishedAt)}
        </p>
      )}

      {renewedUntil && (
        <p className="mt-2 text-sm font-semibold text-brand">Beneficio renovado hasta {formatWaiverDate(renewedUntil)}</p>
      )}

      {status !== "NOT_STARTED" && durationMonths === 0 && (
        <p className="mt-3 text-xs text-slate-500">Beneficio promocional desactivado desde Configuración.</p>
      )}
      {status !== "NOT_STARTED" && durationMonths > 0 && (
        <Button variant="secondary" className="mt-3" onClick={() => onRenew(organization)} disabled={updating}>
          {renewBenefitLabel(status, durationMonths)}
        </Button>
      )}
    </div>
  );
}
