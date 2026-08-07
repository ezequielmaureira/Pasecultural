import { useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { Share2, Link2, MessageCircle, QrCode, Hash, Check, Download } from "lucide-react";
import Button from "../ui/Button.jsx";

// Un botón que copia texto al portapapeles y muestra "Copiado" un segundo —
// mismo patrón que ya usaba ShareInvitationCard.jsx (ahora vive acá, para
// que ambos lo compartan en vez de tener cada uno su propia copia).
function CopyButton({ label, icon: Icon, getText }) {
    const [copied, setCopied] = useState(false);

    async function handleClick() {
        try {
            await navigator.clipboard.writeText(getText());
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            // Portapapeles no disponible (ej. sin HTTPS/permiso) — no rompe nada,
            // se puede seleccionar el texto a mano igual.
        }
    }

    return (
        <Button variant="secondary" size="sm" onClick={handleClick} className="gap-1.5">
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Icon className="h-3.5 w-3.5" />}
            {copied ? "Copiado" : label}
        </Button>
    );
}

// Panel de "compartir" reutilizable — antes vivía sólo dentro de
// ShareInvitationCard.jsx (invitación a Scanner); se extrajo acá para que
// el módulo Cortesías lo use tal cual, sin un segundo sistema de compartir
// paralelo. Ver ShareInvitationCard.jsx, que ahora consume este mismo
// componente.
//
// Mejora progresiva: si el navegador soporta Web Share API
// (navigator.share — Android/iOS y algunos navegadores de escritorio), esa
// es la acción principal y deja que el sistema operativo arme su propia
// lista (WhatsApp/Telegram/Gmail/Mensajes/etc., lo que sea que el
// dispositivo tenga instalado) — nunca se arma esa lista a mano acá. Si no
// hay soporte, cae exactamente al mismo patrón que ya existía: copiar
// enlace + un link directo a WhatsApp + código QR togglable.
//
// `onDownloadPdf` es opcional (ShareInvitationCard no tiene PDF, Cortesías
// sí) — sólo aparece el botón si se pasa.
export default function ShareLinkPanel({ url, title, shareText, code, onDownloadPdf, downloadingPdf }) {
    const [showQr, setShowQr] = useState(false);
    const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
    const textToShare = shareText || url;

    async function handleNativeShare() {
        try {
            await navigator.share({ title, text: shareText, url });
        } catch {
            // El usuario canceló el share sheet, o el navegador lo rechazó por
            // algún motivo propio — nunca es un error que haya que mostrar.
        }
    }

    return (
        <div className="flex flex-col gap-3">
            {canNativeShare && (
                <Button onClick={handleNativeShare} className="w-full justify-center gap-2">
                    <Share2 className="h-4 w-4" />
                    Compartir
                </Button>
            )}

            <div className="flex flex-wrap gap-2">
                <CopyButton label="Copiar enlace" icon={Link2} getText={() => url} />
                {!canNativeShare && (
                    <a
                        href={`https://wa.me/?text=${encodeURIComponent(textToShare)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white/10 px-3 text-sm font-medium text-gray-100 transition-colors duration-150 hover:bg-white/15"
                    >
                        <MessageCircle className="h-3.5 w-3.5" />
                        WhatsApp
                    </a>
                )}
                <Button variant="secondary" size="sm" onClick={() => setShowQr((v) => !v)} className="gap-1.5">
                    <QrCode className="h-3.5 w-3.5" />
                    {showQr ? "Ocultar QR" : "Mostrar QR"}
                </Button>
                {code && <CopyButton label="Copiar código" icon={Hash} getText={() => code} />}
                {onDownloadPdf && (
                    <Button variant="secondary" size="sm" onClick={onDownloadPdf} loading={downloadingPdf} className="gap-1.5">
                        <Download className="h-3.5 w-3.5" />
                        Descargar PDF
                    </Button>
                )}
            </div>

            {showQr && (
                <div className="flex justify-center rounded-lg bg-white p-3">
                    <QRCodeCanvas value={url} size={160} />
                </div>
            )}
        </div>
    );
}
