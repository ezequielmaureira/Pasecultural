import { useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { Link2, MessageCircle, QrCode, Hash, Check } from "lucide-react";
import Card from "../../../components/ui/Card.jsx";
import Button from "../../../components/ui/Button.jsx";

function buildInvitationUrl(token) {
  return `${window.location.origin}/scanner/invitacion/${token}`;
}

// Un botón que copia texto al portapapeles y muestra "Copiado" un segundo
// — mismo patrón chico en los 4 botones de compartir, evita repetir el
// manejo de estado 4 veces.
function CopyButton({ label, icon: Icon, getText }) {
  const [copied, setCopied] = useState(false);

  async function handleClick() {
    try {
      await navigator.clipboard.writeText(getText());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Portapapeles no disponible (ej. sin HTTPS/permiso) — no rompe nada,
      // el organizador puede seleccionar el texto a mano igual.
    }
  }

  return (
    <Button variant="secondary" size="sm" onClick={handleClick} className="gap-1.5">
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Icon className="h-3.5 w-3.5" />}
      {copied ? "Copiado" : label}
    </Button>
  );
}

// Una tarjeta por scanner creado — cada uno tiene su PROPIO token, así que
// nunca comparten link entre sí (revocar uno no afecta a los demás).
export default function ShareInvitationCard({ scanner }) {
  const [showQr, setShowQr] = useState(false);
  const url = buildInvitationUrl(scanner.invitationToken);
  const whatsappText = `Te invito a operar como scanner de "${scanner.name}" en PaseCultural: ${url}`;

  return (
    <Card>
      <div className="flex flex-col gap-3">
        <div>
          <p className="text-sm font-semibold text-white">{scanner.name}</p>
          <p className="text-xs text-slate-500">Invitación válida por 7 días</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <CopyButton label="Copiar enlace" icon={Link2} getText={() => url} />
          <a
            href={`https://wa.me/?text=${encodeURIComponent(whatsappText)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white/10 px-3 text-sm font-medium text-gray-100 transition-colors duration-150 hover:bg-white/15"
          >
            <MessageCircle className="h-3.5 w-3.5" />
            WhatsApp
          </a>
          <Button variant="secondary" size="sm" onClick={() => setShowQr((v) => !v)} className="gap-1.5">
            <QrCode className="h-3.5 w-3.5" />
            {showQr ? "Ocultar QR" : "Mostrar QR"}
          </Button>
          <CopyButton label="Copiar código" icon={Hash} getText={() => scanner.invitationToken} />
        </div>

        {showQr && (
          <div className="flex justify-center rounded-lg bg-white p-3">
            <QRCodeCanvas value={url} size={160} />
          </div>
        )}
      </div>
    </Card>
  );
}
