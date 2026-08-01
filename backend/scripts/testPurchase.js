import prisma from "../src/config/prisma.js";
import { createSaleService, confirmSaleService } from "../src/services/sale.service.js";
import { getQrPayloadService } from "../src/services/ticket.service.js";

(async function main() {
    try {
        console.log("Buscando evento publicado con función y asignaciones...");
        const event = await prisma.event.findFirst({
            where: { status: "PUBLISHED" },
            include: {
                functions: { include: { ticketAssignments: { include: { ticketType: true } } } },
                ticketTypes: true,
                organization: true,
            },
        });

        if (!event) {
            console.error("No hay eventos publicados en la DB.");
            process.exit(1);
        }

        const fn = (event.functions || []).find((f) => (f.ticketAssignments || []).length > 0);
        if (!fn) {
            console.error("El evento no tiene funciones con asignaciones de tickets.");
            process.exit(1);
        }

        const assignment = fn.ticketAssignments.find((a) => a.enabled);
        if (!assignment) {
            console.error("No hay asignaciones habilitadas para la función elegida.");
            process.exit(1);
        }

        // Buscar un usuario comprador (cualquier usuario con clerkId)
        const buyers = await prisma.$queryRawUnsafe(
            `SELECT id, "clerkId" FROM "User" WHERE "clerkId" IS NOT NULL LIMIT 1`
        );
        const buyer = buyers && buyers[0];
        if (!buyer) {
            console.error("No hay usuarios con clerkId en la BD para usar como comprador.");
            process.exit(1);
        }

        console.log("Usando evento:", event.slug, "función:", fn.id, "ticketType:", assignment.ticketTypeId);

        // Guardar sold count antes
        const soldBefore = await prisma.ticket.count({ where: { ticketTypeId: assignment.ticketTypeId, functionId: fn.id, status: { in: ["ACTIVE", "USED"] } } });
        console.log("Sold antes:", soldBefore);

        console.log("Creando Sale PENDING... (createSaleService)");
        const sale = await createSaleService(buyer.clerkId, { eventId: event.id, functionId: fn.id, items: [{ ticketTypeId: assignment.ticketTypeId, quantity: 1 }] });
        console.log("Sale creada (PENDING):", sale.id);

        // Confirmar usando el organizador (confirmSaleService requiere clerkId del owner)
        const orgOwner = await prisma.user.findUnique({ where: { id: event.organization.ownerId } });
        if (!orgOwner || !orgOwner.clerkId) {
            console.error("No se encontró clerkId del organizador para confirmar la venta.");
            process.exit(1);
        }

        console.log("Confirmando venta (confirmSaleService) con clerkId organizador:", orgOwner.clerkId);
        const result = await confirmSaleService(orgOwner.clerkId, sale.id);
        console.log("Venta confirmada. Tickets generados:", result.tickets.length);

        const soldAfter = await prisma.ticket.count({ where: { ticketTypeId: assignment.ticketTypeId, functionId: fn.id, status: { in: ["ACTIVE", "USED"] } } });
        console.log("Sold después:", soldAfter);

        // Verificar ticket QR rows
        const tickets = await prisma.ticket.findMany({ where: { saleId: sale.id } });
        const qrs = await prisma.ticketQr.findMany({ where: { ticketId: { in: tickets.map(t => t.id) } } });

        console.log("Tickets creados:", tickets.map(t => ({ id: t.id, ticketNumber: t.ticketNumber })));
        console.log("TicketQrs creados:", qrs.map(q => ({ id: q.id, ticketId: q.ticketId })));

        // Obtener payload QR vía el service público (lo que usaría la UI)
        try {
            const qrPayload = await getQrPayloadService(buyer.clerkId, tickets[0].id);
            console.log("QR token (payload):", qrPayload.qrToken);
        } catch (err) {
            console.error("No se pudo obtener QR payload:", err.message || err);
        }

        // Verificar no duplicados (ticketNumber uniqueness enforced by DB but check)
        const ticketNumbers = tickets.map(t => t.ticketNumber);
        const duplicates = ticketNumbers.filter((v, i, a) => a.indexOf(v) !== i);
        console.log("Duplicados en ticketNumber:", duplicates.length ? duplicates : "ninguno");

        // ------------- Test: intentar crear una venta por encima del stock -------------
        console.log("Intentando crear una venta por encima del stock (cantidad grande)...");
        const soldNow = await prisma.ticket.count({ where: { ticketTypeId: assignment.ticketTypeId, functionId: fn.id, status: { in: ["ACTIVE", "USED"] } } });
        try {
            await createSaleService(buyer.clerkId, { eventId: event.id, functionId: fn.id, items: [{ ticketTypeId: assignment.ticketTypeId, quantity: 99999 }] });
            console.error("ERROR: createSaleService aceptó una cantidad excesiva (no debería).");
        } catch (err) {
            console.log("createSaleService rechazó cantidad excesiva como se esperaba.", err.message || err.code || err);
        }

        const soldAfterFailedAttempt = await prisma.ticket.count({ where: { ticketTypeId: assignment.ticketTypeId, functionId: fn.id, status: { in: ["ACTIVE", "USED"] } } });
        console.log("Sold después del intento fallido (debe ser igual a antes):", soldNow, "->", soldAfterFailedAttempt);

        // Concluir
        console.log("Test de compra completado correctamente.");
        process.exit(0);
    } catch (err) {
        console.error("Error durante testPurchase:", err);
        process.exit(2);
    }
})();
