import prisma from "../config/prisma.js";
import { round2 } from "../utils/money.js";
import { getWithdrawalReturnInfoForTickets } from "./withdrawalRequest.service.js";

// Ronda de preparación para producción — única regla de "Recaudación" del
// organizador, usada por el listado de ventas (y de ahí por todos los KPIs
// del panel: Dashboard, Entradas, Historial) y por el resumen del Historial
// de Eventos. Antes cada pantalla sumaba Sale.total, que incluye:
//  - el cargo de servicio Smarticket que paga el comprador (se lo queda
//    Smarticket vía marketplace_fee — nunca es plata del organizador), y
//  - ventas ya devueltas (reembolso/contracargo de Mercado Pago o
//    devolución por arrepentimiento).
//
// Por venta CONFIRMED de origen SALE:
//   ticketsAmount = Sale.ticketsSubtotal (o Sale.total en ventas viejas, sin
//                   cargo de servicio, donde ticketsSubtotal es null)
//   serviceFee    = Sale.serviceFee (0 si no había) — informativo, nunca suma
//   refundedAmount:
//     - venta revertida en Mercado Pago (reembolso/contracargo: algún ticket
//       REFUNDED o una fila DeveloperAlertReversalEvent — mismo criterio que
//       ticketAdmin.service.js#findReactivationBlockedTicketIds) => todo
//       ticketsAmount;
//     - si no, la suma del precio unitario de cada ticket devuelto por
//       arrepentimiento (getWithdrawalReturnInfoForTickets).
//   netRevenue    = ticketsAmount − refundedAmount
// Ventas PENDING/CANCELLED/EXPIRED: todo en 0 (nunca hubo cobro).
// Los costos de procesamiento de Mercado Pago NO se descuentan acá: no los
// conocemos por venta (los cobra Mercado Pago directamente al organizador).

const ZERO = Object.freeze({ ticketsAmount: 0, serviceFee: 0, refundedAmount: 0, netRevenue: 0, reversed: false });

export async function getRevenueBreakdownBySaleId(sales, client = prisma) {
    const result = new Map();
    const eligible = sales.filter((sale) => sale.status === "CONFIRMED" && sale.origin === "SALE");
    for (const sale of sales) {
        if (!eligible.includes(sale)) result.set(sale.id, { ...ZERO });
    }
    if (eligible.length === 0) return result;

    const saleIds = eligible.map((sale) => sale.id);
    const [refundedTickets, reversalEvents, cancelledTickets, items] = await Promise.all([
        client.ticket.findMany({ where: { saleId: { in: saleIds }, status: "REFUNDED" }, select: { saleId: true } }),
        client.developerAlertReversalEvent.findMany({ where: { saleId: { in: saleIds } }, select: { saleId: true } }),
        client.ticket.findMany({ where: { saleId: { in: saleIds }, status: "CANCELLED" }, select: { id: true, saleId: true, ticketTypeId: true } }),
        client.saleItem.findMany({ where: { saleId: { in: saleIds } }, select: { saleId: true, ticketTypeId: true, unitPrice: true } }),
    ]);

    const reversedSaleIds = new Set([...refundedTickets, ...reversalEvents].map((row) => row.saleId));
    const unitPriceByKey = new Map(items.map((item) => [`${item.saleId}:${item.ticketTypeId}`, Number(item.unitPrice)]));
    const returnInfo = await getWithdrawalReturnInfoForTickets(cancelledTickets.map((t) => t.id), client);
    const returnedAmountBySaleId = new Map();
    for (const ticket of cancelledTickets) {
        if (!returnInfo.get(ticket.id)) continue;
        const unitPrice = unitPriceByKey.get(`${ticket.saleId}:${ticket.ticketTypeId}`) ?? 0;
        returnedAmountBySaleId.set(ticket.saleId, (returnedAmountBySaleId.get(ticket.saleId) ?? 0) + unitPrice);
    }

    for (const sale of eligible) {
        const ticketsAmount = round2(Number(sale.ticketsSubtotal ?? sale.total ?? 0));
        const serviceFee = round2(Number(sale.serviceFee ?? 0));
        const reversed = reversedSaleIds.has(sale.id);
        const refundedAmount = reversed ? ticketsAmount : round2(Math.min(returnedAmountBySaleId.get(sale.id) ?? 0, ticketsAmount));
        result.set(sale.id, { ticketsAmount, serviceFee, refundedAmount, netRevenue: round2(ticketsAmount - refundedAmount), reversed });
    }
    return result;
}

// Recaudación neta por evento — para resúmenes (Historial de Eventos).
export async function getNetRevenueByEventId(eventIds, client = prisma) {
    const totals = new Map();
    if (eventIds.length === 0) return totals;
    const sales = await client.sale.findMany({
        where: { eventId: { in: eventIds }, status: "CONFIRMED", origin: "SALE", deletedAt: null },
        select: { id: true, eventId: true, status: true, origin: true, total: true, ticketsSubtotal: true, serviceFee: true },
    });
    const breakdown = await getRevenueBreakdownBySaleId(sales, client);
    for (const sale of sales) {
        totals.set(sale.eventId, round2((totals.get(sale.eventId) ?? 0) + breakdown.get(sale.id).netRevenue));
    }
    return totals;
}
