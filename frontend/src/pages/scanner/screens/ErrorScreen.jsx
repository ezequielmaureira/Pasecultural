import { WifiOff, AlertTriangle, RefreshCw } from "lucide-react";
import Button from "../../../components/ui/Button.jsx";
import ScannerCenter from "../components/ScannerCenter.jsx";

// Un mismo layout para "sin conexión" y "error genérico" — nunca un mensaje
// técnico crudo (mensajes de AppError ya vienen amigables desde el
// backend; acá sólo se decide el ícono/título según el tipo).
export default function ErrorScreen({ offline, message, onRetry }) {
    const Icon = offline ? WifiOff : AlertTriangle;
    const title = offline ? "Sin conexión" : "Algo salió mal";
    const description = offline
        ? "No pudimos conectarnos. Revisá tu conexión e intentá de nuevo."
        : message || "No pudimos cargar tus eventos. Intentá de nuevo.";

    return (
        <ScannerCenter>
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-500/10">
                <Icon className="h-7 w-7 text-rose-400" />
            </div>
            <h1 className="text-base font-semibold text-white">{title}</h1>
            <p className="text-sm text-slate-400">{description}</p>
            <Button onClick={onRetry}>
                <RefreshCw className="h-4 w-4" />
                Reintentar
            </Button>
        </ScannerCenter>
    );
}
