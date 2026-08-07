import { User, CheckCircle2, XCircle, Ticket } from "lucide-react";
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

// `allowed` null/undefined = ilimitado (convención acordada con el backend,
// ver computeEntryCounters en scanner.service.js — hoy nunca manda null,
// pero esta pantalla ya sabe qué hacer el día que lo haga). Un solo número
// "usados/permitidos" en vez de tres tarjetas sueltas: representa 1/1,
// 3/10, 7/20 o "usados/∞" con el mismo elemento, sin rediseñar nada cuando
// existan entradas con más de un ingreso.
function EntriesSummary({ used, allowed, remaining }) {
    const isUnlimited = allowed === null || allowed === undefined;
    return (
        <div className="mt-3 w-full rounded-xl bg-white/5 px-4 py-3 text-center">
            <p className="text-2xl font-extrabold text-white">
                {used}
                <span className="text-lg font-semibold text-slate-500"> / {isUnlimited ? "∞" : allowed}</span>
            </p>
            <p className="text-[11px] text-slate-500">
                {isUnlimited ? "Ingresos ilimitados" : remaining > 0 ? `Quedan ${remaining}` : "Sin ingresos restantes"}
            </p>
        </div>
    );
}

// Pantalla de verificación previa al Check-In real — momento 1 confirmado,
// a punto de pasar al momento 2 (ver scanTicketService/confirmScanService
// en el backend). No es un modal ni un overlay secundario: es su PROPIA
// pantalla completa, el centro del flujo del Scanner — reemplaza toda la
// vista de la cámara mientras está abierta (ver ScanningScreen, que la
// monta a nivel raíz, no adentro del contenedor de video).
//
// Jerarquía deliberada, de arriba hacia abajo — lo que el operador necesita
// leer PRIMERO para decidir si esta persona puede entrar:
//   1) Nombre — el elemento más grande de toda la pantalla.
//   2) Tipo de entrada — badge grande, más destacado que el estado: es lo
//      segundo que un operador de puerta necesita saber ("¿VIP o general?"),
//      antes que cualquier dato administrativo.
//   3) Estado — badge secundario, más chico.
//   4) Ficha compacta (evento/función/puerta) — datos de contexto, no de
//      decisión, por eso van después y en tipografía chica.
//   5) Ingresos — un solo número grande, no una grilla de tres tarjetas.
// Deliberadamente NO muestra el número de entrada: no ayuda a identificar
// a la persona, y agregarlo sólo suma ruido a una pantalla que tiene que
// leerse en un segundo.
//
// `data` es exactamente lo que devuelve POST /scanner/scan con status
// "READY" — nunca se recalcula nada acá, sólo se muestra.
//
// Preparado para crecer sin rediseñarse:
//   - Foto del titular: hoy no existe ninguna entrada nominada con foto,
//     así que el círculo de arriba siempre muestra el ícono genérico de
//     `User` — el día que `data` traiga una URL real, sólo hay que
//     renderizar un <img> ahí adentro en vez del ícono, mismo tamaño/lugar.
//   - Ingresos múltiples/ilimitados: ver EntriesSummary arriba.
//   - Puerta: ya viaja en `data.gate` para dejar sentado el lugar en la
//     pantalla antes de que exista control de egresos (que reusaría esta
//     misma estructura con una acción "Confirmar salida" en vez de
//     "Confirmar ingreso" — ver también POST /scanner/scan/confirm, ya
//     anidado bajo /scan para que un futuro /scan/check-out sea coherente).
export default function ScanConfirmationScreen({ data, onConfirm, onDecline, confirming }) {
    return (
        <div className="fixed inset-0 z-30 flex flex-col bg-[#05070B]">
            <div className="flex-1 overflow-y-auto px-5 py-8">
                <div className="mx-auto flex max-w-sm flex-col items-center">
                    <div className="flex h-24 w-24 items-center justify-center rounded-full bg-white/10 ring-2 ring-violet-500/30">
                        <User className="h-11 w-11 text-slate-400" strokeWidth={1.5} />
                    </div>

                    <h1 className="mt-4 text-center text-2xl font-extrabold leading-tight text-white">
                        {data.buyerName || "Sin nombre registrado"}
                    </h1>

                    {data.ticketType && (
                        <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-violet-500/15 px-4 py-1.5 text-sm font-bold text-violet-300">
                            <Ticket className="h-4 w-4" />
                            {data.ticketType}
                        </div>
                    )}

                    <span className="mt-2 inline-flex items-center rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-emerald-400">
                        {STATUS_LABEL[data.ticketStatus] ?? data.ticketStatus}
                    </span>

                    <dl className="mt-6 w-full rounded-xl border border-white/10 bg-white/5 px-4">
                        <Row label="Evento" value={data.eventName} />
                        <Row
                            label="Función"
                            value={data.functionDate ? `${formatFunctionDate(data.functionDate)} · ${formatFunctionTime(data.functionDate)}` : null}
                        />
                        <Row label="Puerta" value={data.gate} />
                    </dl>

                    <EntriesSummary used={data.usedEntries} allowed={data.allowedEntries} remaining={data.remainingEntries} />
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
