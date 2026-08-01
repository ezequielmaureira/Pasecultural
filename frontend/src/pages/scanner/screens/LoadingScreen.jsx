import Spinner from "../../../components/ui/Spinner.jsx";
import ScannerCenter from "../components/ScannerCenter.jsx";

export default function LoadingScreen() {
    return (
        <ScannerCenter>
            <Spinner size="lg" />
            <p className="text-sm text-slate-400">Cargando tus eventos...</p>
        </ScannerCenter>
    );
}
