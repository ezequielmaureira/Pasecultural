import { ScanLine } from "lucide-react";
import ScannerCenter from "../components/ScannerCenter.jsx";

export default function EmptyScreen() {
    return (
        <ScannerCenter>
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/5">
                <ScanLine className="h-7 w-7 text-slate-500" />
            </div>
            <h1 className="text-base font-semibold text-white">No tenés eventos para escanear</h1>
            <p className="text-sm text-slate-400">
                Todavía ningún organizador te habilitó como scanner de un evento. Pedile que te agregue desde el
                panel de su evento.
            </p>
        </ScannerCenter>
    );
}
