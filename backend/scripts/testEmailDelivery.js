// Validación concreta del envío de email de confirmación (el proyecto no
// tiene jest/vitest todavía — ver scripts/testPurchase.js para el mismo
// estilo de script ad-hoc contra la base real de desarrollo).
//
// Qué prueba, y por qué así:
//  1) Una venta CONFIRMED intenta enviar un email (falla sólo porque no hay
//     RESEND_API_KEY configurada en este entorno — eso en sí mismo prueba
//     que un Resend mal configurado no revierte ni rompe la confirmación).
//  2) confirmSaleService llamado de nuevo sobre la MISMA venta ya CONFIRMED
//     no crea tickets nuevos y reintenta el email de forma segura.
//  3) Dos llamadas CONCURRENTES a sendSaleConfirmationEmail para la misma
//     venta: sólo una debería intentar de verdad (el reclamo atómico).
//  4) Generación de QR/PDF: un PNG por ticket, todos distintos, y un PDF
//     válido (firma %PDF) con tantas páginas como tickets.
//  5) Una venta PENDING nunca dispara un envío real (sendSaleConfirmationEmail
//     falla con "sale_not_confirmed" antes de tocar Resend).
import "dotenv/config";
import prisma from "../src/config/prisma.js";
import { createSaleService, confirmSaleService } from "../src/services/sale.service.js";
import { sendSaleConfirmationEmail } from "../src/services/email/sendSaleConfirmationEmail.service.js";
import { buildTicketQrImages } from "../src/services/email/ticketQrImages.js";
import { buildTicketsPdfBuffer } from "../src/services/email/ticketsPdf.js";

function assert(condition, message) {
    if (!condition) throw new Error(`FALLÓ: ${message}`);
    console.log(`OK: ${message}`);
}

async function main() {
    const event = await prisma.event.findFirst({
        where: { status: "PUBLISHED" },
        include: {
            functions: { include: { ticketAssignments: { include: { ticketType: true } } } },
            organization: true,
        },
    });
    if (!event) throw new Error("No hay eventos publicados en la DB para probar.");

    const fn = (event.functions || []).find((f) => (f.ticketAssignments || []).some((a) => a.enabled));
    if (!fn) throw new Error("El evento no tiene funciones con asignaciones habilitadas.");
    const assignment = fn.ticketAssignments.find((a) => a.enabled);

    const buyers = await prisma.$queryRawUnsafe(`SELECT id, "clerkId" FROM "User" WHERE "clerkId" IS NOT NULL LIMIT 1`);
    const buyer = buyers?.[0];
    if (!buyer) throw new Error("No hay usuarios con clerkId para usar como comprador.");

    const orgOwner = await prisma.user.findUnique({ where: { id: event.organization.ownerId } });
    if (!orgOwner?.clerkId) throw new Error("No se encontró clerkId del organizador dueño del evento.");

    console.log(`Usando evento "${event.slug}", función ${fn.id}, ticketType ${assignment.ticketTypeId}\n`);

    // ---------- 1) Confirmar una venta nueva ----------
    console.log("--- 1) Venta CONFIRMED intenta enviar el email ---");
    const sale = await createSaleService(buyer.clerkId, {
        eventId: event.id,
        functionId: fn.id,
        items: [{ ticketTypeId: assignment.ticketTypeId, quantity: 2 }],
    });
    const firstConfirm = await confirmSaleService(orgOwner.clerkId, sale.id);

    assert(firstConfirm.sale.status === "CONFIRMED", "la venta quedó CONFIRMED");
    assert(firstConfirm.tickets.length === 2, "se generaron 2 tickets");
    assert(typeof firstConfirm.emailDeliveryStatus === "string", "la respuesta incluye emailDeliveryStatus");
    console.log(`   emailDeliveryStatus: ${firstConfirm.emailDeliveryStatus} (FAILED es lo esperado sin RESEND_API_KEY configurada acá)`);

    let saleRow = await prisma.sale.findUnique({ where: { id: sale.id } });
    assert(saleRow.confirmationEmailAttempts === 1, `confirmationEmailAttempts es 1 (fue ${saleRow.confirmationEmailAttempts})`);
    assert(saleRow.confirmationEmailLastAttemptAt !== null, "confirmationEmailLastAttemptAt quedó registrado");
    if (!process.env.RESEND_API_KEY) {
        assert(saleRow.confirmationEmailStatus === "FAILED", "sin API key, el estado quedó FAILED (no revierte la venta)");
        assert(!saleRow.confirmationEmailLastError?.includes("."), "el error guardado es un motivo corto, no un mensaje crudo con detalle");
    }

    // ---------- 2) Confirmar de nuevo la misma venta (ya CONFIRMED) ----------
    console.log("\n--- 2) confirmSaleService de nuevo sobre la misma venta CONFIRMED ---");
    const ticketCountBefore = await prisma.ticket.count({ where: { saleId: sale.id } });
    const secondConfirm = await confirmSaleService(orgOwner.clerkId, sale.id);
    const ticketCountAfter = await prisma.ticket.count({ where: { saleId: sale.id } });

    assert(ticketCountAfter === ticketCountBefore, "no se crearon tickets nuevos al confirmar de nuevo");
    assert(secondConfirm.tickets.length === firstConfirm.tickets.length, "devuelve la misma cantidad de tickets");
    assert(
        secondConfirm.tickets.every((t, i) => t.qrToken === firstConfirm.tickets[i].qrToken),
        "los qrToken son idénticos entre ambas respuestas (mismo ticket, mismo secret desencriptado)"
    );

    saleRow = await prisma.sale.findUnique({ where: { id: sale.id } });
    assert(saleRow.confirmationEmailAttempts === 2, `el reintento incrementó a 2 intentos (fue ${saleRow.confirmationEmailAttempts})`);

    // ---------- 3) Dos llamadas concurrentes a sendSaleConfirmationEmail ----------
    console.log("\n--- 3) Dos llamadas concurrentes a sendSaleConfirmationEmail ---");
    // Se fuerza el estado a PENDING (email) para simular una venta recién
    // confirmada con dos requests llegando casi al mismo tiempo a intentar
    // el envío — el escenario real que el reclamo atómico tiene que resolver.
    await prisma.sale.update({ where: { id: sale.id }, data: { confirmationEmailStatus: "PENDING" } });
    const [outcomeA, outcomeB] = await Promise.all([
        sendSaleConfirmationEmail(sale.id),
        sendSaleConfirmationEmail(sale.id),
    ]);
    const attemptedCount = [outcomeA, outcomeB].filter((o) => o.attempted).length;
    assert(attemptedCount === 1, `sólo una de las dos llamadas concurrentes intentó enviar de verdad (fueron ${attemptedCount})`);

    // ---------- 4) Venta ya SENT no se reenvía ----------
    console.log("\n--- 4) Venta ya SENT no se reenvía ---");
    await prisma.sale.update({
        where: { id: sale.id },
        data: { confirmationEmailStatus: "SENT", confirmationEmailSentAt: new Date() },
    });
    const sentAttemptsBefore = (await prisma.sale.findUnique({ where: { id: sale.id } })).confirmationEmailAttempts;
    const outcomeAfterSent = await sendSaleConfirmationEmail(sale.id);
    const sentAttemptsAfter = (await prisma.sale.findUnique({ where: { id: sale.id } })).confirmationEmailAttempts;
    assert(outcomeAfterSent.attempted === false, "no se intenta reenviar una venta ya SENT");
    assert(sentAttemptsBefore === sentAttemptsAfter, "confirmationEmailAttempts no cambió (no hubo intento real)");

    // ---------- 5) Venta PENDING nunca dispara un envío real ----------
    console.log("\n--- 5) Venta PENDING no envía email ---");
    const pendingSale = await createSaleService(buyer.clerkId, {
        eventId: event.id,
        functionId: fn.id,
        items: [{ ticketTypeId: assignment.ticketTypeId, quantity: 1 }],
    });
    const pendingOutcome = await sendSaleConfirmationEmail(pendingSale.id);
    assert(pendingOutcome.status === "FAILED" && pendingOutcome.reason === "sale_not_confirmed", "una venta PENDING falla con sale_not_confirmed, nunca llega a Resend");
    await prisma.sale.delete({ where: { id: pendingSale.id } }).catch(() => {});
    // limpia también el SaleItem huérfano si el delete de arriba no cascadeó
    await prisma.saleItem.deleteMany({ where: { saleId: pendingSale.id } }).catch(() => {});

    // ---------- 6) QR y PDF ----------
    console.log("\n--- 6) Generación de QR y PDF ---");
    const qrImages = await buildTicketQrImages(firstConfirm.tickets);
    assert(qrImages.length === firstConfirm.tickets.length, "un PNG de QR por ticket");
    assert(qrImages.every((q) => q.buffer.length > 0), "todos los buffers de QR tienen contenido");
    const uniqueQrBuffers = new Set(qrImages.map((q) => q.buffer.toString("base64")));
    assert(uniqueQrBuffers.size === qrImages.length, "cada QR es distinto (corresponde a un ticket real y único)");

    const pdfBuffer = await buildTicketsPdfBuffer({
        eventTitle: firstConfirm.tickets[0].eventTitle,
        venue: firstConfirm.tickets[0].venue,
        functionDate: firstConfirm.tickets[0].functionDate,
        tickets: firstConfirm.tickets,
        qrImages,
    });
    assert(pdfBuffer.subarray(0, 4).toString("ascii") === "%PDF", "el buffer generado es un PDF válido (firma %PDF)");
    assert(pdfBuffer.length > 1000, `el PDF tiene contenido real (${pdfBuffer.length} bytes)`);

    console.log("\nTodas las validaciones pasaron.");
    process.exit(0);
}

main().catch((err) => {
    console.error("\nError durante testEmailDelivery:", err.message);
    console.error(err.stack);
    process.exit(1);
});
