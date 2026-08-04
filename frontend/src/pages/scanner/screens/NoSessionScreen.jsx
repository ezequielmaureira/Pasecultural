import { Link } from "react-router-dom";
import { ScanLine } from "lucide-react";
import Button from "../../../components/ui/Button.jsx";
import ScannerCenter from "../components/ScannerCenter.jsx";

// No hay ningún "iniciar sesión" acá — el único camino de entrada al
// módulo Scanner es un enlace de invitación con su código de verificación
// (ver ScannerInvitationClaim.jsx). Si no hay scannerSessionToken guardado,
// no hay nada que mostrar más que eso.
export default function NoSessionScreen() {
    return (
        <ScannerCenter>
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/5">
                <ScanLine className="h-7 w-7 text-slate-500" />
            </div>
            <h1 className="text-base font-semibold text-white">No tenés una sesión de scanner activa</h1>
            <p className="text-sm text-slate-400">
                Pedile al organizador del evento el enlace de invitación para registrarte como scanner.
            </p>
            <Link to="/">
                <Button variant="secondary">Volver al inicio</Button>
            </Link>
        </ScannerCenter>
    );
}
