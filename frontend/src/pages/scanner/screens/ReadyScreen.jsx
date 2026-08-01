import { Play } from "lucide-react";
import ScannerCenter from "../components/ScannerCenter.jsx";
import { formatFunctionDate, formatFunctionTime } from "../scannerFormat.js";

export default function ReadyScreen({ event, fn, onChangeFunction, canChangeFunction, onChangeEvent, canChangeEvent, onStartScanning }) {
    return (
        <ScannerCenter>
            <p className="text-xs uppercase tracking-wide text-slate-500">Función activa</p>
            <h1 className="text-xl font-bold text-white">{event.title}</h1>
            <p className="text-sm text-slate-400">
                {formatFunctionDate(fn.date)} · {formatFunctionTime(fn.date)} hs
            </p>
            <p className="text-sm text-violet-400">
                {fn.checkedIn} ingresados / {fn.capacity} · {fn.remaining} restantes
            </p>

            <button
                type="button"
                onClick={onStartScanning}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-violet-500 bg-violet-500/10 px-4 py-4 text-sm font-bold uppercase tracking-wide text-violet-300 transition-colors duration-150 hover:bg-violet-500/20"
            >
                <Play className="h-4 w-4" />
                Iniciar escaneo
            </button>

            <div className="flex items-center gap-4">
                {canChangeFunction && (
                    <button
                        type="button"
                        onClick={onChangeFunction}
                        className="text-xs font-medium text-slate-500 underline-offset-2 hover:text-white hover:underline"
                    >
                        Cambiar función
                    </button>
                )}
                {canChangeEvent && (
                    <button
                        type="button"
                        onClick={onChangeEvent}
                        className="text-xs font-medium text-slate-500 underline-offset-2 hover:text-white hover:underline"
                    >
                        Cambiar evento
                    </button>
                )}
            </div>
        </ScannerCenter>
    );
}
