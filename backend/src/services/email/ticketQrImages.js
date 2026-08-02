import QRCode from "qrcode";

// PNG en memoria por ticket — nunca un archivo temporal en disco, nunca un
// servicio externo. `contentId` es el nombre que después referencia tanto
// el adjunto inline del email (`cid:ticket-qr-1`) como, indirectamente, la
// imagen embebida en el PDF (mismo buffer, no se genera dos veces).
export async function buildTicketQrImages(tickets) {
    return Promise.all(
        tickets.map(async (ticket, index) => ({
            ticket,
            contentId: `ticket-qr-${index + 1}`,
            buffer: await QRCode.toBuffer(ticket.qrToken, {
                type: "png",
                width: 320,
                margin: 1,
                color: { dark: "#0B1120", light: "#FFFFFF" },
            }),
        }))
    );
}
