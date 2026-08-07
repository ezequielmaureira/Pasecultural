import { User, CheckCircle2, XCircle } from "lucide-react";
import { formatFunctionDate, formatFunctionTime } from "../scannerFormat.js";

const STATUS_LABEL = {
    ACTIVE: "Vigente",
};

function Row({ label, value }) {
    if (!value) return null;
    return (
        <div className="flex items-center justify-between gap-3 border-b border-white/5 py-2 last:border-0">
            <dt className="text-xs text-slate-500">{label}</dt>
            <dd className="truncate text-right text-sm font-medium text-white">{value}</dd>
        </div>
    );
}

function Stat({ label, value }) {
    return (
        <div className="rounded-lg bg-white/5 px-2 py-2.5 text-center">
            <p className="text-xl font-bold text-white">{value}</p>
            <p className="text-[11px] text-slate-500">{label}</p>
        </div>
    );
}

// Pantalla de verificación previa al Check-In real — momento 2 del flujo
// (ver scanTicketService/checkInService en el backend). No es un modal ni
// un overlay secundario: es su PROPIA pantalla completa, el centro del
// flujo del Scanner — reemplaza toda la vista de la cámara mientras está
// abierta (ver ScanningScreen, que la monta a nivel raíz, no adentro del
// contenedor de video). El operador tiene que poder identificar a la
// persona de un vistazo antes de decidir: por eso el nombre queda arriba de
// todo, grande, y las acciones son sólo dos, enormes.
//
// `data` es exactamente lo que devuelve POST /scanner/scan con status
// "READY" — nunca se recalcula nada acá, sólo se muestra.
//
// Preparado para crecer sin rediseñarse:
//   - Foto del titular: hoy no existe ninguna entrada nominada con foto,
//     así que el círculo de arriba siempre muestra el ícono genérico de
//     `User` — el día que `data` traiga una URL real, sólo hay que
//     renderizar un <img> ahí adentro en vez del ícono, mismo tamaño/lugar.
//   - Ingresos permitidos/usados/restantes: son datos reales del backend
//     (computeEntryCounters en scanner.service.js), no texto fijo acá — un
//     ticket con múltiples ingresos o ilimitados sólo cambia esos tres
//     números, la fila de stats ya está lista para mostrarlos tal cual.
//   - Puerta: ya viaja en `data.gate` para dejar sentado el lugar en la
//     pantalla antes de que exista control de egresos (que reusaría esta
//     misma estructura con una acción "Confirmar salida" en vez de
//     "Confirmar ingreso").
export default function ScanConfirmationScreen({ data, onConfirm, onDecline, confirming }) {
    return (
        <div className="fixed inset-0 z-30 flex flex-col bg-[#05070B]">
            <div className="flex-1 overflow-y-auto px-5 py-8">
                <div className="mx-auto flex max-w-sm flex-col items-center">
                    <div className="flex h-24 w-24 items-center justify-center rounded-full bg-white/10 ring-2 ring-violet-500/30">
                        <User className="h-11 w-11 text-slate-400" strokeWidth={1.5} />
                    </div>

                    <h1 className="mt-4 text-center text-2xl font-extrabold text-white">
                        {data.buyerName || "Sin nombre registrado"}
                    </h1>
                    {data.ticketType && <p className="mt-1 text-center text-sm font-semibold text-violet-300">{data.ticketType}</p>}
                    <span className="mt-2 inline-flex items-center rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-bold uppercase tracking-wide text-emerald-400">
                        {STATUS_LABEL[data.ticketStatus] ?? data.ticketStatus}
                    </span>

                    <dl className="mt-6 w-full rounded-xl border border-white/10 bg-white/5 px-4">
                        <Row label="Evento" value={data.eventName} />
                        <Row label="Fecha" value={formatFunctionDate(data.functionDate)} />
                        <Row label="Hora" value={formatFunctionTime(data.functionDate)} />
                        <Row label="Lugar" value={data.venue} />
                        <Row label="Puerta" value={data.gate} />
                        <Row label="N° de entrada" value={data.ticketNumber} />
                    </dl>

                    <div className="mt-3 grid w-full grid-cols-3 gap-2">
                        <Stat label="Permitidos" value={data.allowedEntries} />
                        <Stat label="Usados" value={data.usedEntries} />
                        <Stat label="Restantes" value={data.remainingEntries} />
                    </div>
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
