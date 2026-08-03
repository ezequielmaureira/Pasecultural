import { useNavigate } from "react-router-dom";
import ScannerInviteChat from "./scannerChat/ScannerInviteChat.jsx";

export default function OrganizerScannerInvite() {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-[70vh] flex-1 flex-col">
      <div className="mb-2">
        <h1 className="text-xl font-bold text-white">Agregar scanner</h1>
        <p className="text-sm text-slate-400">Vamos a agregar un nuevo scanner. Respondé una pregunta a la vez.</p>
      </div>

      <ScannerInviteChat onDone={() => navigate("/organizador/scanners")} />
    </div>
  );
}
