import { ImageOff, ChevronRight, Check } from "lucide-react";
import ScannerCenter from "../components/ScannerCenter.jsx";

// `embedded`: sin el wrapper de pantalla completa ni el título — para
// insertarse arriba del Dashboard cuando el scanner tiene más de un evento
// asignado (ver DashboardScreen.jsx), en vez de duplicar este mapeo
// evento->botón en un componente aparte. El uso de pantalla completa (mid-
// flujo de escaneo, "Cambiar evento" desde ReadyScreen) sigue exactamente
// igual, `embedded` por default es false.
// `activeEventId`: sólo tiene sentido en el uso embebido, para resaltar
// cuál es el evento actualmente elegido — en la pantalla completa nunca hay
// uno ya elegido, así que por default no resalta nada.
export default function EventSelectScreen({ events, onSelect, embedded = false, activeEventId = null }) {
    const list = (
        <div className="flex w-full flex-col gap-2">
            {events.map((event) => {
                const isActive = event.id === activeEventId;
                return (
                    <button
                        key={event.id}
                        type="button"
                        onClick={() => onSelect(event)}
                        className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-colors duration-150 ${
                            isActive
                                ? "border-violet-500/60 bg-violet-500/10"
                                : "border-white/10 bg-[#0B1120] hover:border-violet-500/40"
                        }`}
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
                        {isActive ? (
                            <Check className="h-4 w-4 shrink-0 text-violet-400" />
                        ) : (
                            <ChevronRight className="h-4 w-4 shrink-0 text-slate-600" />
                        )}
                    </button>
                );
            })}
        </div>
    );

    if (embedded) return list;

    return (
        <ScannerCenter>
            <p className="text-xs uppercase tracking-wide text-slate-500">Elegí un evento</p>
            <h1 className="text-lg font-bold text-white">Asignados a vos ahora</h1>
            {list}
        </ScannerCenter>
    );
}
