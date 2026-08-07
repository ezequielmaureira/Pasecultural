import Card from "../../../components/ui/Card.jsx";
import ShareLinkPanel from "../../../components/organizer/ShareLinkPanel.jsx";

function buildInvitationUrl(token) {
  return `${window.location.origin}/scanner/invitacion/${token}`;
}

// Una tarjeta por scanner creado — cada uno tiene su PROPIO token, así que
// nunca comparten link entre sí (revocar uno no afecta a los demás). Todo
// el botonaje de compartir (Web Share nativo si el dispositivo lo soporta,
// copiar enlace, WhatsApp, QR) vive en ShareLinkPanel — reutilizado tal
// cual por el módulo Cortesías, que ahora lo usa con la misma experiencia.
export default function ShareInvitationCard({ scanner }) {
  const url = buildInvitationUrl(scanner.invitationToken);
  const shareText = `Te invito a operar como scanner de "${scanner.name}" en PaseCultural: ${url}`;

  return (
    <Card>
      <div className="flex flex-col gap-3">
        <div>
          <p className="text-sm font-semibold text-white">{scanner.name}</p>
          <p className="text-xs text-slate-500">Invitación válida por 7 días</p>
        </div>

        <ShareLinkPanel
          url={url}
          title={`Invitación a Scanner — ${scanner.name}`}
          shareText={shareText}
          code={scanner.invitationToken}
        />
      </div>
    </Card>
  );
}
