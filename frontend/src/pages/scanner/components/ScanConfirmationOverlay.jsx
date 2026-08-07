import { User, CheckCircle2, XCircle } from "lucide-react";
import { formatFunctionDate, formatFunctionTime } from "../scannerFormat.js";

const STATUS_LABEL = {
    ACTIVE: "Vigente",
};

function Row({ label, value }) {
    if (!value) return null;
    return (
        <div className="flex items-center justify-between gap-3">
            <dt className="text-slate-500">{label}</dt>
            <dd className="truncate text-right font-medium text-white">{value}</dd>
        </div>
    );
}

function Stat({ label, value }) {
    return (
        <div className="rounded-lg bg-white/5 px-2 py-2">
            <p className="text-lg font-bold text-white">{value}</p>
            <p className="text-[11px] text-slate-500">{label}</p>
        </div>
    );
}

// Pantalla de verificación previa al Check-In real (paso 1 del flujo en dos
// fases — ver previewScanService en el backend). SIEMPRE aparece antes de
// registrar nada: el operador ve contra quién está a punto de autorizar el
// ingreso y decide. Sólo dos acciones, ambas grandes (pensado para
// aprentarse rápido y sin errores desde un celular, con el pulgar) — nada
// de botones chicos acá.
//
// `data` es exactamente lo que devuelve GET .../scan-preview con status
// "READY" — nunca se recalcula nada acá, sólo se muestra. `avatar`: hoy
// siempre el ícono genérico de `User` porque no existe foto asociada a
// ninguna entrada todavía — el layout ya reserva ese círculo así que el día
// que exista una URL de foto real, sólo hay que reemplazar el ícono por un
// <img>, sin rediseñar la pantalla.
export default function ScanConfirmationOverlay({ data, onConfirm, onDecline, confirming }) {
    return (
        <div className="absolute inset-0 z-20 flex flex-col bg-[#05070B]">
            <div className="flex-1 overflow-y-auto px-5 py-6">
                <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-white/10">
                    <User className="h-9 w-9 text-slate-400" strokeWidth={1.75} />
                </div>

                <h1 className="text-center text-xl font-bold text-white">{data.buyerName || "Sin nombre registrado"}</h1>
                {data.ticketType && <p className="mt-0.5 text-center text-sm font-medium text-violet-300">{data.ticketType}</p>}

                <dl className="mt-5 flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 p-4 text-sm">
                    <Row label="Evento" value={data.eventName} />
                    <Row
                        label="Función"
                        value={data.functionDate ? `${formatFunctionDate(data.functionDate)} · ${formatFunctionTime(data.functionDate)}` : null}
                    />
                    <Row label="Lugar" value={data.venue} />
                    <Row label="N° de entrada" value={data.ticketNumber} />
                    <Row label="Estado" value={STATUS_LABEL[data.ticketStatus] ?? data.ticketStatus} />
                </dl>

                <div className="mt-3 grid grid-cols-3 gap-2">
                    <Stat label="Permitidos" value={data.allowedEntries} />
                    <Stat label="Usados" value={data.usedEntries} />
                    <Stat label="Restantes" value={data.remainingEntries} />
                </div>
            </div>

            <div className="flex flex-col gap-2 border-t border-white/10 bg-black/60 p-4">
                <button
                    type="button"
                    onClick={onConfirm}
                    disabled={confirming}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-5 text-base font-extrabold uppercase tracking-wide text-white transition-colors duration-150 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                    <CheckCircle2 className="h-5 w-5" />
                    {confirming ? "Confirmando..." : "Confirmar ingreso"}
                </button>
                <button
                    type="button"
                    onClick={onDecline}
                    disabled={confirming}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-rose-500/50 bg-transparent px-4 py-4 text-sm font-bold uppercase tracking-wide text-rose-400 transition-colors duration-150 hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                >
                    <XCircle className="h-4 w-4" />
                    Declinar
                </button>
            </div>
        </div>
    );
}
