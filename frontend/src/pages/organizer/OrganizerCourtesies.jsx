import { Link } from "react-router-dom";
import { Gift, History, ChevronRight } from "lucide-react";

// Landing del módulo — sólo dos acciones, pedido explícito. Mismo lenguaje
// visual que el resto del panel (Card oscura, borde sutil), sin traer un
// componente nuevo para esto: son dos <Link> con el mismo patrón de tarjeta
// clickable que ya usan otras pantallas del organizador.
const ACTIONS = [
    {
        to: "/organizador/cortesias/emitir",
        icon: Gift,
        title: "Emitir cortesía",
        description: "Generá una entrada sin costo para un invitado, sponsor, prensa o staff.",
    },
    {
        to: "/organizador/cortesias/historial",
        icon: History,
        title: "Historial de cortesías",
        description: "Consultá, reenviá, descargá o cancelá las cortesías ya emitidas.",
    },
];

export default function OrganizerCourtesies() {
    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-xl font-bold text-white">Cortesías</h1>
                <p className="text-sm text-slate-400">
                    Entradas sin costo para invitados, sponsors, prensa, artistas, staff u otros casos especiales.
                </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
                {ACTIONS.map(({ to, icon: Icon, title, description }) => (
                    <Link
                        key={to}
                        to={to}
                        className="group flex items-start gap-4 rounded-xl border border-white/10 bg-[#0B1120] p-6 transition-colors duration-150 hover:border-violet-500/40"
                    >
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-400">
                            <Icon className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="font-semibold text-white">{title}</p>
                            <p className="mt-1 text-sm text-slate-400">{description}</p>
                        </div>
                        <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-slate-600 transition-colors duration-150 group-hover:text-violet-400" />
                    </Link>
                ))}
            </div>
        </div>
    );
}
