import { CheckCircle2, RotateCcw, ArrowLeftRight, Ban, HelpCircle, WifiOff, Clock } from "lucide-react";
import { SCAN_RESULT_TONE, SCAN_RESULT_LABEL } from "../scanResultConfig.js";

const ICON_BY_STATUS = {
    VALID: CheckCircle2,
    ALREADY_USED: RotateCcw,
    WRONG_EVENT: ArrowLeftRight,
    CANCELLED: Ban,
    NOT_FOUND: HelpCircle,
    OFFLINE: WifiOff,
    TIMEOUT: Clock,
};

function formatTime(value) {
    if (!value) return null;
    return new Date(value).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

// Pantalla completa, color sólido — nunca un modal ni una tarjeta chica
// (tiene que leerse de reojo). Un solo componente para los 5 estados del
// backend + los pseudo-estados sintetizados en el cliente (OFFLINE,
// TIMEOUT). Todos los datos vienen tal cual del backend (buildResult en
// scanner.service.js) — nada se recalcula ni se inventa acá.
//
// `labelOverride`: sólo lo usa ScanningScreen para distinguir, en el
// flujo de confirmación en dos fases, un ALREADY_USED detectado recién al
// confirmar (otro scanner se adelantó mientras esta pantalla estaba
// abierta) del mismo estado detectado directo en la lectura — mismo
// componente, mismo tono/ícono, un texto más específico para ese caso
// puntual en vez de duplicar la pantalla entera.
export default function ScanResultOverlay({ status, data, labelOverride }) {
    const Icon = ICON_BY_STATUS[status] ?? HelpCircle;

    return (
        <div className={`absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 px-8 text-center ${SCAN_RESULT_TONE[status] ?? SCAN_RESULT_TONE.NOT_FOUND}`}>
            <Icon className="h-20 w-20" strokeWidth={1.75} />
            <h1 className="text-2xl font-extrabold uppercase tracking-wide">{labelOverride ?? SCAN_RESULT_LABEL[status]}</h1>

            {status === "VALID" && (
                <div className="mt-1 flex flex-col gap-0.5">
                    {data?.buyerName && <p className="text-lg font-semibold">{data.buyerName}</p>}
                    <p className="text-sm opacity-90">
                        {data?.ticketType}
                        {data?.ticketType && data?.ticketNumber ? " · " : ""}
                        {data?.ticketNumber}
                    </p>
                    {data?.eventName && <p className="text-sm opacity-90">{data.eventName}</p>}
                    <p className="text-xs opacity-75">
                        {formatTime(data?.scannedAt)}
                        {data?.scannerName ? ` · ${data.scannerName}` : ""}
                        {data?.gate ? ` · ${data.gate}` : ""}
                    </p>
                </div>
            )}

            {status === "ALREADY_USED" && (
                <div className="mt-1 flex flex-col gap-0.5">
                    {data?.firstScannedAt && <p className="text-sm font-medium opacity-90">Ingresó a las {formatTime(data.firstScannedAt)}</p>}
                    {data?.firstScannedGate && <p className="text-xs opacity-75">{data.firstScannedGate}</p>}
                </div>
            )}

            {status === "CANCELLED" && data?.ticketNumber && (
                <p className="text-sm font-medium opacity-90">{data.ticketNumber}</p>
            )}
        </div>
    );
}
