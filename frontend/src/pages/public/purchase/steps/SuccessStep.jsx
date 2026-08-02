import { useEffect, useRef, useState } from "react";
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
  // "idle" | "generating" | "error" — por ticket, no global: descargar el
  // PDF de una entrada no debe bloquear el botón de las demás.
  const [downloadState, setDownloadState] = useState("idle");

  function handleDownloadPdf() {
    if (downloadState === "generating") return; // evita disparos dobles antes del re-render
    setDownloadState("generating");
    try {
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
      setDownloadState("idle");
    } catch {
      setDownloadState("error");
    }
  }

  return (
    <div className="flex w-full min-w-0 max-w-[280px] flex-col items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-4 text-center">
      <div ref={qrRef} className="rounded-lg bg-white p-2">
        <QRCodeCanvas value={ticket.qrToken} size={140} />
      </div>
      <div className="w-full min-w-0 space-y-0.5 break-words">
        <p className="text-sm font-semibold text-white">{ticket.eventTitle}</p>
        <p className="text-xs text-slate-400">{formatFunctionDate(ticket.functionDate)}</p>
        <p className="text-xs text-slate-400">{ticket.venue}</p>
        <p className="text-xs text-slate-400">{ticket.ticketTypeName}</p>
        <p className="text-xs text-slate-500">Entrada N° {ticket.ticketNumber}</p>
      </div>
      <Button
        variant="secondary"
        onClick={handleDownloadPdf}
        loading={downloadState === "generating"}
        loadingText="Generando PDF..."
        className="w-full justify-center gap-1.5"
      >
        <Download className="h-4 w-4" />
        Descargar PDF
      </Button>
      {downloadState === "error" && (
        <p className="text-xs text-rose-400">No pudimos generar el PDF. Probá de nuevo.</p>
      )}
    </div>
  );
}

// Pantalla pública de éxito: se arma exclusivamente con lo que ya devolvió
// confirm-by-buyer (ver PurchaseWizard). Nunca navega a "Mis entradas" ni a
// nada protegido por Clerk — el comprador invitado no tiene, ni va a tener,
// sesión.
//
// El aviso de "también te lo mandamos por correo" se muestra con sólo que
// `buyerEmail` exista — YA NO depende de `emailDeliveryStatus === "SENT"`.
// Motivo: el envío real (Resend) puede seguir en curso (SENDING) en el
// instante exacto en que se arma esta pantalla — sobre todo en producción,
// donde la latencia hace más probable que la respuesta llegue antes de que
// el email termine de mandarse — y esta pantalla nunca vuelve a consultar
// después para enterarse de que pasó a SENT. Depender de ese estado exacto
// era la causa de que el aviso apareciera en localhost y no en Vercel,
// aunque el correo se mandara bien en los dos casos. `emailDeliveryStatus`
// se sigue recibiendo igual — sólo que ahora es información interna (log),
// no una condición visual.
export default function SuccessStep({ tickets, buyerEmail, emailDeliveryStatus, onKeepExploring }) {
  const hasTickets = Array.isArray(tickets) && tickets.length > 0;

  useEffect(() => {
    if (emailDeliveryStatus && emailDeliveryStatus !== "SENT") {
      console.info("SuccessStep: emailDeliveryStatus todavía no es SENT en el momento del render", emailDeliveryStatus);
    }
  }, [emailDeliveryStatus]);

  return (
    <Card>
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10">
          <CheckCircle2 className="h-9 w-9 text-emerald-400" />
        </div>
        <h2 className="text-lg font-bold text-white">¡Compra realizada con éxito!</h2>

        <p className="text-sm text-slate-400">
          {hasTickets
            ? "Tu compra fue confirmada. Podés ver y descargar tus entradas a continuación."
            : "Tu compra fue confirmada."}
        </p>

        {hasTickets && (
          // auto-fit + minmax: 1 sola entrada queda centrada (una única
          // columna, sin estirarse); con 2+ arma tantas columnas de hasta
          // 280px como entren, y las centra como grupo si sobra espacio.
          // `justify-center` es lo que hace que no quede pegado a la
          // izquierda cuando hay una sola tarjeta.
          <div className="mt-2 grid w-full grid-cols-[repeat(auto-fit,minmax(220px,280px))] justify-center gap-3">
            {tickets.map((ticket) => (
              <TicketCard key={ticket.id} ticket={ticket} />
            ))}
          </div>
        )}

        {buyerEmail && (
          <p className="mt-2 text-xs text-slate-500">
            También te vamos a mandar tus entradas al correo{" "}
            <span className="text-slate-300">{buyerEmail}</span>. Si no las recibís en unos minutos, más
            adelante vas a poder recuperarlas desde la opción "Recuperar mis entradas".
          </p>
        )}

        <div className="mt-4 flex w-full flex-col gap-2">
          <Button onClick={onKeepExploring} className="w-full justify-center">
            Seguir explorando eventos
          </Button>
        </div>
      </div>
    </Card>
  );
}
