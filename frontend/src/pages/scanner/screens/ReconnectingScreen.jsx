import Spinner from "../../../components/ui/Spinner.jsx";
import ScannerCenter from "../components/ScannerCenter.jsx";

// Se pinta con lo que ya había en localStorage, sin esperar ninguna
// respuesta de red — exactamente como se aprobó en la Fase 0: el operador
// ve de inmediato dónde está parado, mientras la validación real corre
// atrás. `offline` cambia el subtítulo sin sacar el spinner (se sigue
// reintentando solo apenas vuelva la conexión).
export default function ReconnectingScreen({ eventName, functionName, offline }) {
    return (
        <ScannerCenter>
            <p className="text-xs uppercase tracking-wide text-slate-500">Función activa</p>
            <h1 className="text-xl font-bold text-white">{eventName}</h1>
            <p className="text-sm text-slate-400">{functionName}</p>
            <div className="mt-2 flex items-center gap-2 text-sm text-slate-500">
                <Spinner size="sm" />
                {offline ? "Sin conexión — reintentando..." : "Reconectando..."}
            </div>
        </ScannerCenter>
    );
}
