import { CameraOff, RefreshCw, SwitchCamera } from "lucide-react";
import Button from "../../../components/ui/Button.jsx";
import ScannerCenter from "../components/ScannerCenter.jsx";

const MESSAGE_BY_TYPE = {
    denied: "No pudimos acceder a la cámara. Habilitá el permiso en la configuración del navegador.",
    busy: "La cámara está siendo usada por otra aplicación. Cerrala e intentá de nuevo.",
    unsupported: "Este navegador no soporta cámara. Probá con Chrome o Safari actualizados.",
    lost: "Se perdió la conexión con la cámara. Reconectala e intentá de nuevo.",
    unknown: "No pudimos abrir la cámara. Intentá de nuevo.",
};

// Los 4 casos de la Fase 0 (permiso denegado / ocupada / sin soporte /
// desconectada) caen en esta misma pantalla — mismo layout, mensaje
// específico. Nunca se muestra el error técnico crudo del navegador.
export default function CameraErrorScreen({ type, onRetry, onSwitchCamera, canSwitchCamera, onChangeFunction, onBack }) {
    return (
        <ScannerCenter>
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-500/10">
                <CameraOff className="h-7 w-7 text-rose-400" />
            </div>
            <p className="text-sm text-slate-400">{MESSAGE_BY_TYPE[type] ?? MESSAGE_BY_TYPE.unknown}</p>

            <div className="flex w-full flex-col gap-2">
                <Button onClick={onRetry} className="w-full justify-center">
                    <RefreshCw className="h-4 w-4" />
                    Reintentar
                </Button>
                {canSwitchCamera && (
                    <Button variant="secondary" onClick={onSwitchCamera} className="w-full justify-center">
                        <SwitchCamera className="h-4 w-4" />
                        Elegir otra cámara
                    </Button>
                )}
                <Button variant="secondary" onClick={onChangeFunction} className="w-full justify-center">
                    Cambiar función
                </Button>
                <Button variant="ghost" onClick={onBack} className="w-full justify-center">
                    Volver
                </Button>
            </div>
        </ScannerCenter>
    );
}
