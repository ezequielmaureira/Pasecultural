import { ChevronRight } from "lucide-react";
import ScannerCenter from "../components/ScannerCenter.jsx";
import { formatFunctionDate, formatFunctionTime } from "../scannerFormat.js";

export default function FunctionSelectScreen({ event, onSelect, onBack }) {
    return (
        <ScannerCenter>
            <p className="text-xs uppercase tracking-wide text-slate-500">{event.title}</p>
            <h1 className="text-lg font-bold text-white">Elegí la función</h1>

            <div className="flex w-full flex-col gap-2">
                {event.functions.map((fn) => (
                    <button
                        key={fn.id}
                        type="button"
                        onClick={() => onSelect(fn)}
                        className="flex items-center gap-3 rounded-xl border border-white/10 bg-[#0B1120] p-3 text-left transition-colors duration-150 hover:border-violet-500/40"
                    >
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-white">
                                {formatFunctionDate(fn.date)} · {formatFunctionTime(fn.date)} hs
                            </p>
                            <p className="mt-0.5 text-xs text-slate-500">
                                {fn.checkedIn} ingresados / {fn.capacity} · {fn.remaining} restantes
                            </p>
                        </div>
                        <ChevronRight className="h-4 w-4 shrink-0 text-slate-600" />
                    </button>
                ))}
            </div>

            {onBack && (
                <button
                    type="button"
                    onClick={onBack}
                    className="text-xs font-medium text-slate-500 underline-offset-2 hover:text-white hover:underline"
                >
                    Volver a eventos
                </button>
            )}
        </ScannerCenter>
    );
}
