import { useRef } from "react";
import { CheckCircle2, Download } from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";
import { jsPDF } from "jspdf";
import Card from "../../../../components/ui/Card.jsx";
import Button from "../../../../components/ui/Button.jsx";

function formatFunctionDate(isoDate) {
  if (!isoDate) return "";
  try {
    return new Date(isoDate).toLocaleString("es-AR", {
      dateStyle: "long",
      timeStyle: "short",
    });
  } catch {
    return isoDate;
  }
}

// El QR se dibuja siempre a partir del `qrToken` que ya vino en la
// respuesta de confirm-by-buyer — nunca se vuelve a pedir a la API (el
// comprador invitado no tiene sesión con la que hacerlo).
function TicketCard({ ticket }) {
  const qrRef = useRef(null);

  function handleDownloadPdf() {
    const canvas = qrRef.current?.querySelector("canvas");
    const doc = new jsPDF({ unit: "mm", format: "a6" });

    doc.setFontSize(14);
    doc.text(ticket.eventTitle || "Entrada", 10, 15, { maxWidth: 85 });
    doc.setFontSize(10);
    doc.text(formatFunctionDate(ticket.functionDate), 10, 24, { maxWidth: 85 });
    doc.text(ticket.venue || "", 10, 30, { maxWidth: 85 });
    doc.text(`Tipo: ${ticket.ticketTypeName || ""}`, 10, 38);
    doc.text(`Entrada N°: ${ticket.ticketNumber}`, 10, 44);

    if (canvas) {
      const qrDataUrl = canvas.toDataURL("image/png");
      doc.addImage(qrDataUrl, "PNG", 10, 50, 40, 40);
    }

    doc.save(`entrada-${ticket.ticketNumber}.pdf`);
  }

  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-4 text-center">
      <div ref={qrRef} className="rounded-lg bg-white p-2">
        <QRCodeCanvas value={ticket.qrToken} size={140} />
      </div>
      <div className="space-y-0.5">
        <p className="text-sm font-semibold text-white">{ticket.eventTitle}</p>
        <p className="text-xs text-slate-400">{formatFunctionDate(ticket.functionDate)}</p>
        <p className="text-xs text-slate-400">{ticket.venue}</p>
        <p className="text-xs text-slate-400">{ticket.ticketTypeName}</p>
        <p className="text-xs text-slate-500">Entrada N° {ticket.ticketNumber}</p>
      </div>
      <Button variant="secondary" onClick={handleDownloadPdf} className="w-full justify-center gap-1.5">
        <Download className="h-4 w-4" />
        Descargar PDF
      </Button>
    </div>
  );
}

// Pantalla pública de éxito: se arma exclusivamente con lo que ya devolvió
// confirm-by-buyer (ver PurchaseWizard). Nunca navega a "Mis entradas" ni a
// nada protegido por Clerk — el comprador invitado no tiene, ni va a tener,
// sesión.
export default function SuccessStep({ tickets, buyerEmail, onKeepExploring }) {
  const hasTickets = Array.isArray(tickets) && tickets.length > 0;

  return (
    <Card>
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10">
          <CheckCircle2 className="h-9 w-9 text-emerald-400" />
        </div>
        <h2 className="text-lg font-bold text-white">¡Compra realizada con éxito!</h2>

        {hasTickets ? (
          <p className="text-sm text-slate-400">Estas son tus entradas.</p>
        ) : (
          <p className="text-sm text-slate-400">
            Tu compra se confirmó. Revisá tu email para ver tus entradas.
          </p>
        )}

        {hasTickets && (
          <div className="mt-2 grid w-full gap-3 sm:grid-cols-2">
            {tickets.map((ticket) => (
              <TicketCard key={ticket.id} ticket={ticket} />
            ))}
          </div>
        )}

        {buyerEmail && (
          <p className="mt-2 text-xs text-slate-500">
            También enviamos estas entradas al correo <span className="text-slate-300">{buyerEmail}</span>.
          </p>
        )}

        <div className="mt-4 flex w-full flex-col gap-2">
          <Button variant="secondary" onClick={onKeepExploring} className="w-full justify-center">
            Seguir explorando eventos
          </Button>
        </div>
      </div>
    </Card>
  );
}
