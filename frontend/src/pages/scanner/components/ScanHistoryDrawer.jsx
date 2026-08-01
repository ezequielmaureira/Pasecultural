import { useEffect, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { X, AlertTriangle, RefreshCw } from "lucide-react";
import Spinner from "../../../components/ui/Spinner.jsx";
import Button from "../../../components/ui/Button.jsx";
import { listScanAttempts } from "../../../lib/scannerApi.js";
import { SCAN_RESULT_LABEL, SCAN_RESULT_BADGE_TONE } from "../scanResultConfig.js";

function formatTime(value) {
    return new Date(value).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

// Consume exclusivamente GET /api/scanner/scan-attempts — no recalcula ni
// acumula nada del lado del cliente. Se vuelve a pedir cada vez que se abre
// (no se cachea entre aperturas): es justo la pantalla que alguien abre
// para chequear "qué pasó recién", tiene que reflejar el estado real.
export default function ScanHistoryDrawer({ eventId, functionId, onClose }) {
    const { getToken } = useAuth();
    const [attempts, setAttempts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    async function load() {
        setLoading(true);
        setError("");
        try {
            const token = await getToken();
            setAttempts(await listScanAttempts(token, { eventId, functionId }));
        } catch (err) {
            setError(err.message || "No pudimos cargar el historial.");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div className="absolute inset-0 z-30 flex flex-col justify-end bg-black/60" onClick={onClose}>
            <div
                onClick={(e) => e.stopPropagation()}
                className="flex max-h-[70vh] flex-col rounded-t-2xl border-t border-white/10 bg-[#0B1120]"
            >
                <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
                    <h2 className="text-sm font-semibold text-white">Últimos escaneos</h2>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Cerrar historial"
                        className="text-slate-400 transition-colors duration-150 hover:text-white"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto px-5 py-3">
                    {loading && (
                        <div className="flex flex-col items-center gap-2 py-10">
                            <Spinner size="md" />
                        </div>
                    )}

                    {!loading && error && (
                        <div className="flex flex-col items-center gap-3 py-10 text-center">
                            <AlertTriangle className="h-6 w-6 text-rose-400" />
                            <p className="text-sm text-slate-400">{error}</p>
                            <Button size="sm" variant="secondary" onClick={load}>
                                <RefreshCw className="h-3.5 w-3.5" />
                                Reintentar
                            </Button>
                        </div>
                    )}

                    {!loading && !error && attempts.length === 0 && (
                        <p className="py-10 text-center text-sm text-slate-500">Todavía no escaneaste ningún QR.</p>
                    )}

                    {!loading && !error && attempts.length > 0 && (
                        <div className="flex flex-col divide-y divide-white/5">
                            {attempts.map((attempt) => (
                                <div key={attempt.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                                    <span
                                        className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${SCAN_RESULT_BADGE_TONE[attempt.result] ?? "bg-white/10 text-slate-400"}`}
                                    >
                                        {SCAN_RESULT_LABEL[attempt.result] ?? attempt.result}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        {attempt.buyerName && (
                                            <p className="truncate text-sm font-medium text-white">{attempt.buyerName}</p>
                                        )}
                                        {attempt.ticketType && (
                                            <p className="truncate text-xs text-slate-500">
                                                {attempt.ticketType}
                                                {attempt.ticketNumber ? ` · ${attempt.ticketNumber}` : ""}
                                            </p>
                                        )}
                                    </div>
                                    <span className="shrink-0 font-mono text-xs text-slate-500">
                                        {formatTime(attempt.scannedAt)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
