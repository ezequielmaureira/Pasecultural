import { ImageOff, ChevronRight } from "lucide-react";
import ScannerCenter from "../components/ScannerCenter.jsx";

export default function EventSelectScreen({ events, onSelect }) {
    return (
        <ScannerCenter>
            <p className="text-xs uppercase tracking-wide text-slate-500">Elegí un evento</p>
            <h1 className="text-lg font-bold text-white">Asignados a vos ahora</h1>

            <div className="flex w-full flex-col gap-2">
                {events.map((event) => (
                    <button
                        key={event.id}
                        type="button"
                        onClick={() => onSelect(event)}
                        className="flex items-center gap-3 rounded-xl border border-white/10 bg-[#0B1120] p-3 text-left transition-colors duration-150 hover:border-violet-500/40"
                    >
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/5">
                            {event.coverImage ? (
                                <img src={event.coverImage} alt={event.title} className="h-full w-full object-cover" />
                            ) : (
                                <ImageOff className="h-5 w-5 text-slate-600" />
                            )}
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-white">{event.title}</p>
                            <p className="text-xs text-slate-500">
                                {event.functions.length} función{event.functions.length === 1 ? "" : "es"}
                            </p>
                        </div>
                        <ChevronRight className="h-4 w-4 shrink-0 text-slate-600" />
                    </button>
                ))}
            </div>
        </ScannerCenter>
    );
}
