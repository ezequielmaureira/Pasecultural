import { useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import Spinner from "../../../components/ui/Spinner.jsx";
import Button from "../../../components/ui/Button.jsx";
import ScannerCenter from "../components/ScannerCenter.jsx";
import { getFunctionStats } from "../../../lib/scannerApi.js";
import { readScannerSessionToken } from "../../../lib/scannerSessionStorage.js";
import { functionLabel } from "../scannerFormat.js";

// Sólo lectura — a diferencia de ReadyScreen (que también muestra
// capacidad/ingresados/restantes pero como paso previo a escanear), esta
// pantalla consume el endpoint /functions/:functionId/stats que ya existía
// en el backend pero el frontend nunca llamaba (ver scannerApi.js), con el
// desglose por tipo de entrada que ReadyScreen no muestra.
//
// `gate` opcional — recordatorio de contexto (mismo motivo que en
// ScanningScreen/ScanConfirmationScreen: un scanner que trabaja varios
// eventos en el día nunca debería perder de vista dónde está parado).
export default function ScannerStatsScreen({ event, fn, gate, onBack }) {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    async function load() {
        setLoading(true);
        setError("");
        try {
            const token = readScannerSessionToken();
            setStats(await getFunctionStats(token, event.id, fn.id));
        } catch (err) {
            setError(err.message || "No pudimos cargar las estadísticas.");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [event.id, fn.id]);

    return (
        <ScannerCenter>
            <p className="text-xs uppercase tracking-wide text-slate-500">Estadísticas</p>
            <h1 className="text-lg font-bold text-white">{event.title}</h1>
            <p className="-mt-2 text-xs text-slate-500">
                {functionLabel(fn)}
                {gate ? ` · ${gate}` : ""}
            </p>

            {loading && <Spinner size="lg" />}

            {!loading && error && (
                <div className="flex flex-col items-center gap-3">
                    <AlertTriangle className="h-6 w-6 text-rose-400" />
                    <p className="text-sm text-slate-400">{error}</p>
                    <Button size="sm" variant="secondary" onClick={load}>
                        <RefreshCw className="h-3.5 w-3.5" />
                        Reintentar
                    </Button>
                </div>
            )}

            {!loading && !error && stats && (
                <div className="w-full rounded-xl border border-white/10 bg-white/5 p-4 text-left">
                    <p className="text-sm text-violet-400">
                        {stats.checkedIn} ingresados / {stats.capacity} · {stats.remaining} restantes
                    </p>
                    {stats.byTicketType.length > 0 && (
                        <div className="mt-3 flex flex-col divide-y divide-white/5 border-t border-white/10">
                            {stats.byTicketType.map((t) => (
                                <div key={t.ticketTypeId} className="flex items-center justify-between gap-3 py-2 text-sm">
                                    <span className="truncate text-slate-300">{t.name}</span>
                                    <span className="shrink-0 text-slate-400">
                                        {t.checkedIn}/{t.capacity}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            <Button variant="secondary" onClick={onBack} className="w-full justify-center">
                Volver
            </Button>
        </ScannerCenter>
    );
}
