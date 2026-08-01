import { Link, Outlet } from "react-router-dom";
import { X } from "lucide-react";

// Layout propio del Scanner: pantalla completa, sin sidebar ni navegación
// administrativa (a diferencia de AppShell, que usan organizador/developer).
// Tiene que sentirse como una terminal, no como un panel — cero elementos
// que no sean necesarios para escanear. El único elemento de navegación es
// una salida chica y fija en la esquina — nunca un menú.
export default function ScannerShell() {
    return (
        <div className="min-h-screen bg-[#05070B] text-white">
            <Link
                to="/"
                aria-label="Salir del modo Scanner"
                className="fixed right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-slate-400 transition-colors duration-150 hover:bg-white/10 hover:text-white"
            >
                <X className="h-4 w-4" />
            </Link>
            <Outlet />
        </div>
    );
}
