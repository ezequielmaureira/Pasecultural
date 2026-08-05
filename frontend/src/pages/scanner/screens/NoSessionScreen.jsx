import { Link } from "react-router-dom";
import { ScanLine } from "lucide-react";
import Button from "../../../components/ui/Button.jsx";
import ScannerCenter from "../components/ScannerCenter.jsx";

// Si ya te registraste alguna vez (invitación + código, ver
// ScannerInvitationClaim.jsx), el camino de acá en más es el Portal Scanner
// (email + código, ScannerPortal.jsx) — la invitación deja de servir para
// volver a entrar. Si todavía no te registraste, seguís necesitando el
// enlace de invitación del organizador.
export default function NoSessionScreen() {
    return (
        <ScannerCenter>
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/5">
                <ScanLine className="h-7 w-7 text-slate-500" />
            </div>
            <h1 className="text-base font-semibold text-white">No tenés una sesión de scanner activa</h1>
            <p className="text-sm text-slate-400">¿Ya te registraste como scanner? Entrá desde el Portal Scanner.</p>
            <Link to="/scanner/portal" className="w-full">
                <Button className="w-full justify-center">Ir al Portal Scanner</Button>
            </Link>
            <p className="text-xs text-slate-500">
                Si todavía no te registraste, pedile al organizador del evento el enlace de invitación.
            </p>
            <Link to="/">
                <Button variant="secondary">Volver al inicio</Button>
            </Link>
        </ScannerCenter>
    );
}
