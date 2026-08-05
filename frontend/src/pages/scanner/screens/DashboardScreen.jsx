import { ScanLine, History, BarChart3, LogOut } from "lucide-react";
import Button from "../../../components/ui/Button.jsx";
import ScannerCenter from "../components/ScannerCenter.jsx";

const STATUS_LABEL = {
    ACTIVE: "Activo",
    DISABLED: "Desactivado",
};

function formatLastAccess(value) {
    if (!value) return "Todavía no ingresaste";
    return new Date(value).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
}

// Pantalla previa al lector QR — nunca abre la cámara directo. Muestra
// quién sos, dónde operás y cuánto llevás hoy, y desde acá se decide a
// dónde ir: escanear (lógica existente, sin cambios), historial,
// estadísticas, o cerrar sesión.
export default function DashboardScreen({ dashboard, onStartScanning, onOpenHistory, onOpenStats, onLogout }) {
    const displayName = [dashboard.firstName, dashboard.lastName].filter(Boolean).join(" ").trim() || dashboard.name;

    return (
        <ScannerCenter>
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-violet-500/10">
                <ScanLine className="h-7 w-7 text-violet-400" />
            </div>
            <h1 className="text-lg font-bold text-white">{displayName}</h1>

            <div className="w-full rounded-xl border border-white/10 bg-white/5 p-4 text-left">
                <dl className="flex flex-col gap-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                        <dt className="text-slate-500">Evento</dt>
                        <dd className="truncate font-medium text-white">{dashboard.eventTitle}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                        <dt className="text-slate-500">Puerta</dt>
                        <dd className="truncate font-medium text-white">{dashboard.gate}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                        <dt className="text-slate-500">Estado</dt>
                        <dd className="font-medium text-emerald-400">{STATUS_LABEL[dashboard.status] ?? dashboard.status}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                        <dt className="text-slate-500">Último acceso</dt>
                        <dd className="font-medium text-white">{formatLastAccess(dashboard.lastAccessAt)}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-2">
                        <dt className="text-slate-500">Validadas hoy</dt>
                        <dd className="text-base font-bold text-violet-300">{dashboard.validatedToday}</dd>
                    </div>
                </dl>
            </div>

            <button
                type="button"
                onClick={onStartScanning}
                className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-violet-500 bg-violet-500/10 px-4 py-4 text-sm font-bold uppercase tracking-wide text-violet-300 transition-colors duration-150 hover:bg-violet-500/20"
            >
                <ScanLine className="h-4 w-4" />
                Escanear entradas
            </button>

            <div className="flex w-full gap-3">
                <Button variant="secondary" onClick={onOpenHistory} className="flex-1 justify-center gap-1.5">
                    <History className="h-4 w-4" />
                    Historial
                </Button>
                <Button variant="secondary" onClick={onOpenStats} className="flex-1 justify-center gap-1.5">
                    <BarChart3 className="h-4 w-4" />
                    Estadísticas
                </Button>
            </div>

            <button
                type="button"
                onClick={onLogout}
                className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 transition-colors duration-150 hover:text-white"
            >
                <LogOut className="h-3.5 w-3.5" />
                Cerrar sesión
            </button>
        </ScannerCenter>
    );
}
