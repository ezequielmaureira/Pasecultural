import PDFDocument from "pdfkit";
import { formatFunctionDateTimeAR } from "./formatDateAR.js";

// Un único PDF por venta, una página por ticket — no depende de window,
// document, canvas ni de nada exclusivo del navegador (a diferencia del
// generador del frontend, que sí usa <canvas> para el QR): acá el QR ya
// llega como PNG (ver ticketQrImages.js) y pdfkit arma el documento entero
// en memoria, devuelto como Buffer.
export async function buildTicketsPdfBuffer({ eventTitle, venue, functionDate, tickets, qrImages }) {
    const qrByTicketId = new Map(qrImages.map((qr) => [qr.ticket.id, qr.buffer]));
    const formattedDate = formatFunctionDateTimeAR(functionDate);

    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: "A6", margin: 24 });
        const chunks = [];
        doc.on("data", (chunk) => chunks.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);

        tickets.forEach((ticket, index) => {
            if (index > 0) doc.addPage();

            doc.fillColor("#7c3aed").fontSize(12).font("Helvetica-Bold").text("PaseCultural");
            doc.moveDown(0.6);

            doc.fillColor("#111827").fontSize(13).font("Helvetica-Bold").text(eventTitle, { width: 240 });
            doc.moveDown(0.3);

            doc.fillColor("#374151").fontSize(9).font("Helvetica");
            doc.text(formattedDate, { width: 240 });
            if (venue) doc.text(venue, { width: 240 });
            doc.text(`Tipo: ${ticket.ticketTypeName || ""}`);
            doc.text(`Entrada N°: ${ticket.ticketNumber}`);
            doc.moveDown(0.6);

            const qrBuffer = qrByTicketId.get(ticket.id);
            if (qrBuffer) {
                doc.image(qrBuffer, doc.x, doc.y, { fit: [140, 140] });
                doc.moveDown(9);
            }

            doc.fillColor("#6b7280").fontSize(7.5).font("Helvetica").text(
                "Presentá este código QR al ingresar al evento. No lo compartas: es personal e intransferible.",
                { width: 240 }
            );
        });

        doc.end();
    });
}
