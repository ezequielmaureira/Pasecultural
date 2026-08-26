import crypto from "node:crypto";
import prisma from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { getUserByClerkId } from "../utils/getUserByClerkId.js";
import { runArchiveSelfHeal } from "./eventArchive.service.js";
import { isValidEmail } from "../utils/validateEmail.js";
import { normalizeBuyerDocument, isValidBuyerDocument } from "../utils/validateBuyerDocument.js";
import { buildTicketNumber } from "../utils/ticketNumber.js";
import { encryptSecret, decryptSecret } from "../config/qrEncryption.js";
import { effectiveCapacity, SOLD_TICKET_STATUSES, acquireTicketTypeFunctionLock, getUnavailableCount } from "./functionCapacity.service.js";
import { logger } from "../logging/logger.js";
import { sendSaleConfirmationEmail, getSaleEmailData } from "./email/sendSaleConfirmationEmail.service.js";
import { buildTicketQrImages } from "./email/ticketQrImages.js";
import { buildTicketsPdfBuffer } from "./email/ticketsPdf.js";
import { round2 } from "../utils/money.js";
import { getValidatedServiceFeeTiersOrThrow, calculateServiceFeeForUnitPrice } from "./serviceFee.service.js";
import { sendDeveloperAlert, DeveloperAlertType, tryClaimDeveloperAlertCooldown } from "./email/sendDeveloperAlert.service.js";
import { getDeveloperAlertConfigOrDefaults } from "./developerAlertConfig.service.js";
import { sendOrganizerNotification, OrganizerNotificationType } from "./email/sendOrganizerNotification.service.js";
import {
    buildOrganizationContact,
    getWithdrawalReturnInfoForTickets,
    isWithinWithdrawalReturnWindow,
    WITHDRAWAL_RETURN_VISIBILITY_HOURS,
} from "./withdrawalRequest.service.js";
import {
    getOrganizerNotificationSettingsOrDefaults,
    tryClaimOrganizerNotification,
    computeCrossedStepMilestones,
    hasCrossedThresholdDown,
    hasJustSoldOut,
} from "./organizerNotificationSettings.service.js";

const ACTIVE_TICKET_STATUSES = SOLD_TICKET_STATUSES;

// MP-2.1 — cuánto dura una reserva de stock (Sale.stockReservedUntil)
// mientras el comprador está en Checkout Pro. 15 minutos: pensado para
// medios de pago INSTANTÁNEOS únicamente (tarjeta de crédito/débito,
// dinero en cuenta) — MP-2.1 excluye explícitamente los medios de pago en
// efectivo (Rapipago/Pago Fácil/etc, payment_type_id "ticket") de la
// preferencia (ver mercadoPagoCheckout.service.js) precisamente porque la
// documentación oficial de Mercado Pago confirma que esos pueden tardar
// 3+ días hábiles en acreditarse — completamente incompatible con
// cualquier TTL de reserva corto. Con sólo medios instantáneos
// habilitados, 15 minutos da margen de sobra para completar el pago
// (incluida una verificación 3-D Secure/OTP del banco, o corregir un
// número de tarjeta mal tipeado) sin bloquear el stock más de lo
// razonable para otros compradores. No es un número copiado del pedido
// original sin pensar: se evaluó contra la única referencia temporal
// comparable que ya existía en el proyecto (el authorization code de
// OAuth de Mercado Pago vale 10 minutos, MP-1) y se decidió un poco más
// largo a propósito, porque acá el reloj arranca ANTES de que el
// comprador llegue a la pantalla de Mercado Pago (incluye la creación de
// la preferencia y el redirect), no al llegar a ella.
const STOCK_RESERVATION_TTL_MS = 15 * 60 * 1000;

const SALE_LIST_INCLUDE = {
    buyer: { select: { id: true, firstName: true, lastName: true, email: true } },
    event: { select: { id: true, title: true, organizationId: true } },
    function: { select: { id: true, date: true, venue: true } },
    items: { include: { ticketType: { select: { id: true, name: true } } } },
};

async function getOrganizationByOwner(userId) {
    return prisma.organization.findFirst({ where: { ownerId: userId } });
}

// Cuánto stock queda disponible para un tipo de entrada en una función
// puntual: capacidad (override de la función, o quantity del catálogo) menos
// tickets ya emitidos (ACTIVE o USED, nunca CANCELLED/REFUNDED) para esa
// combinación exacta. Nunca se guarda en una columna que se decrementa — se
// calcula siempre al vuelo, lo que deja la puerta abierta a agregar reservas
// temporales a futuro (contar también ventas PENDING no vencidas) sin
// rediseñar Sale ni Ticket.
async function getSoldCount(client, ticketTypeId, functionId) {
    return client.ticket.count({
        where: {
            ticketTypeId,
            functionId,
            status: { in: ACTIVE_TICKET_STATUSES },
            deletedAt: null,
        },
    });
}

// El comprador NUNCA necesita autenticarse con Clerk para comprar — busca o
// crea un User por email, con clerkId null ("invitado"). Postgres permite
// múltiples NULL en una columna @unique, así que muchos invitados conviven
// sin chocar entre sí. Si esta persona ya tenía cuenta real (clerkId no
// nulo), se reutiliza esa cuenta tal cual — no se pisan sus datos.
async function getOrCreateGuestBuyer({ firstName, lastName, email }) {
    const normalizedEmail = email?.trim().toLowerCase();
    if (!firstName?.trim() || !lastName?.trim() || !normalizedEmail) {
        throw new AppError(ErrorCodes.GUEST_BUYER_INFO_REQUIRED);
    }
    if (!isValidEmail(normalizedEmail)) {
        throw new AppError(ErrorCodes.GUEST_BUYER_INVALID_EMAIL);
    }

    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) return existing;

    return prisma.user.create({
        data: { email: normalizedEmail, firstName: firstName.trim(), lastName: lastName.trim(), clerkId: null },
    });
}

// Núcleo compartido de creación de venta, ya con el comprador resuelto (con
// cuenta real o invitado — a esta altura da lo mismo). NO descuenta stock
// todavía — el chequeo de disponibilidad acá es best-effort (evita que el
// comprador arme una reserva imposible), pero el chequeo autoritativo y
// definitivo ocurre recién en confirmSale(), bajo lock, que es el único
// punto que realmente genera tickets.
// `options` es la única forma en la que el módulo Cortesías (courtesy.service.js)
// se engancha a este mismo núcleo sin bifurcarlo:
//   - requireBuyerDocument: el DNI existe para la futura recuperación de
//     compras reales — una cortesía nunca le pide DNI a nadie.
//   - enforceMaxPerPurchase: ese límite es anti-scalping para el checkout
//     público; no tiene sentido contra un organizador autorizado emitiendo
//     entradas propias.
//   - origin: se graba tal cual en la Sale — el resto de esta función
//     (validación de evento/función/tipo de entrada, chequeo de STOCK) es
//     IDÉNTICO para los dos orígenes a propósito: una cortesía consume el
//     mismo cupo que una venta real, nunca hay overselling por este atajo.
// Los dos callers existentes (createSaleService/createGuestSaleService) no
// pasan `options` — quedan con el comportamiento exacto de siempre.
// Exportada (además de usada internamente por create[Guest]SaleService) para
// que courtesy.service.js la reutilice tal cual con su propio buyer ya
// resuelto y `options` relajadas — nunca reimplementa esta validación.
export async function createSaleForBuyer(buyer, input, options = {}) {
    const {
        requireBuyerDocument = true,
        enforceMaxPerPurchase = true,
        origin = "SALE",
        // MP-2 — sólo lo pasa mercadoPagoCheckout.service.js. paymentMethod
        // por default MANUAL preserva el comportamiento exacto de siempre
        // para los dos callers preexistentes (createSaleService/
        // createGuestSaleService sin options, y courtesy.service.js).
        // checkoutIdempotencyKey es null salvo que el caller de MP-2 haya
        // recibido uno del comprador — @unique en Sale, ver el informe de
        // MP-2 para el mecanismo completo de protección contra doble submit.
        paymentMethod = "MANUAL",
        checkoutIdempotencyKey = null,
        // MP-2.1 — idem, sólo lo pasa mercadoPagoCheckout.service.js
        // (external_reference dedicado, nunca publicRecoveryToken — ver el
        // informe de MP-2.1).
        mercadoPagoExternalReference = null,
        // MP-6 — idem, sólo lo pasa mercadoPagoCheckout.service.js. `false`
        // por default preserva el comportamiento exacto de siempre para
        // los dos callers preexistentes (createSaleService/createGuestSaleService
        // sin options, y courtesy.service.js): total sigue siendo
        // únicamente la suma de SaleItem.subtotal, sin comisión. Ver
        // serviceFee.service.js para el cálculo en sí.
        applyServiceFee = false,
        // Ronda de endurecimiento — protección OPTIMISTA contra la carrera
        // "el comprador vio un resumen, pero el precio de una entrada y/o
        // los rangos de comisión cambiaron antes de que confirmara la
        // compra". null (default) preserva el comportamiento exacto de
        // siempre para los dos callers preexistentes — sólo
        // mercadoPagoCheckout.service.js pasa esto, y sólo cuando el
        // comprador mandó los tres números. NUNCA es la fuente de verdad:
        // sólo se COMPARA contra el cálculo autoritativo de abajo, nunca
        // se usa para calcular nada.
        expectedTotals = null,
    } = options;
    const event = await prisma.event.findUnique({ where: { id: input?.eventId } });
    if (!event) throw new AppError(ErrorCodes.EVENT_NOT_FOUND);

    // Guard autoritativo de FREE_ENTRY — punto único de choque de los tres
    // caminos que pueden llegar acá (venta manual, Mercado Pago vía
    // createGuestSaleService, y cortesías vía courtesy.service.js): un
    // evento de entrada gratuita nunca puede generar una Sale, sin
    // excepción. Chequeado ANTES de tocar tipos de entrada/stock — un
    // FREE_ENTRY nunca tiene TicketTypes de todas formas, pero este guard
    // da el mensaje correcto en vez de un genérico "entrada no encontrada".
    if (event.admissionType === "FREE_ENTRY") {
        throw new AppError(ErrorCodes.EVENT_FREE_ENTRY_NO_SALES);
    }

    const eventFunction = await prisma.eventFunction.findUnique({ where: { id: input?.functionId } });
    if (!eventFunction || eventFunction.eventId !== event.id) {
        throw new AppError(ErrorCodes.FUNCTION_NOT_FOUND);
    }

    const itemsInput = Array.isArray(input?.items) ? input.items : [];
    if (itemsInput.length === 0) {
        throw new AppError(ErrorCodes.SALE_ITEMS_REQUIRED);
    }
    for (const item of itemsInput) {
        if (!item?.ticketTypeId || !Number.isInteger(item.quantity) || item.quantity <= 0) {
            throw new AppError(ErrorCodes.INVALID_SALE_ITEM);
        }
    }

    // Preparación para la futura recuperación segura de entradas (ver
    // Sale.buyerDocument en schema.prisma) — obligatorio para toda venta
    // real NUEVA de acá en adelante; las ventas viejas simplemente no lo
    // tienen y siguen funcionando igual (QR, PDF, recuperación por
    // publicRecoveryToken no dependen de este campo para nada). Una
    // cortesía (requireBuyerDocument: false) nunca lo pide — si de todos
    // modos vino uno, se valida igual en vez de guardarlo tal cual.
    let buyerDocument = null;
    if (requireBuyerDocument && !input?.buyerDocument) {
        throw new AppError(ErrorCodes.GUEST_BUYER_DOCUMENT_REQUIRED);
    }
    if (input?.buyerDocument) {
        buyerDocument = normalizeBuyerDocument(input.buyerDocument);
        if (!isValidBuyerDocument(buyerDocument)) {
            throw new AppError(ErrorCodes.GUEST_BUYER_INVALID_DOCUMENT);
        }
    }

    const ticketTypeIds = [...new Set(itemsInput.map((item) => item.ticketTypeId))];
    const assignments = await prisma.functionTicketType.findMany({
        where: { functionId: eventFunction.id, ticketTypeId: { in: ticketTypeIds } },
        include: { ticketType: true },
    });
    const assignmentByTicketTypeId = new Map(assignments.map((a) => [a.ticketTypeId, a]));

    // MP-6 — se lee y revalida ANTES de tocar precios/stock, nunca dentro
    // del advisory lock de más abajo (la comisión no compite por ningún
    // recurso escaso, no hace falta serializarla contra nada): si no hay
    // una configuración válida, se aborta acá mismo, sin haber creado
    // ninguna Sale ni tocado ningún lock. Ver serviceFee.service.js —
    // fallar fuerte acá es exactamente lo que evita un checkout con
    // comisión $0 por accidente.
    const serviceFeeTiers = applyServiceFee ? await getValidatedServiceFeeTiersOrThrow() : null;

    // Validaciones/precio que NO dependen de disponibilidad en vivo
    // (existe, está habilitado, respeta maxPerPurchase) — no hace falta
    // ningún lock para esto, sólo leen el catálogo.
    const saleItemsData = [];
    for (const item of itemsInput) {
        const assignment = assignmentByTicketTypeId.get(item.ticketTypeId);
        if (!assignment || assignment.ticketType.eventId !== event.id) {
            throw new AppError(ErrorCodes.TICKET_TYPE_NOT_FOUND);
        }
        if (!assignment.enabled) {
            throw new AppError(ErrorCodes.TICKET_TYPE_NOT_AVAILABLE);
        }
        if (enforceMaxPerPurchase && item.quantity > assignment.ticketType.maxPerPurchase) {
            throw new AppError(ErrorCodes.MAX_PER_PURCHASE_EXCEEDED, { details: { ticketTypeId: item.ticketTypeId } });
        }

        const unitPrice = round2(assignment.priceOverride ?? assignment.ticketType.price);
        const subtotal = round2(unitPrice * item.quantity);
        const itemData = { ticketTypeId: item.ticketTypeId, quantity: item.quantity, unitPrice, subtotal, serviceFeeUnit: null, serviceFeeSubtotal: null };

        if (serviceFeeTiers) {
            const serviceFeeUnit = calculateServiceFeeForUnitPrice(unitPrice, serviceFeeTiers);
            if (serviceFeeUnit === null) {
                // Precio positivo que no cae en ningún rango configurado —
                // configuración incompleta (debería ser imposible si pasó
                // validateServiceFeeTiersInput, pero nunca se asume: mismo
                // criterio "fallar fuerte, nunca comisión $0 por accidente".
                logger.error(new Error("service fee: el precio unitario de un item no cae en ningún rango configurado"), {
                    ticketTypeId: item.ticketTypeId,
                    unitPrice,
                });
                throw new AppError(ErrorCodes.SERVICE_FEE_CONFIG_MISSING);
            }
            itemData.serviceFeeUnit = serviceFeeUnit;
            itemData.serviceFeeSubtotal = round2(serviceFeeUnit * item.quantity);
        }

        saleItemsData.push(itemData);
    }

    const ticketsSubtotal = round2(saleItemsData.reduce((sum, item) => sum + item.subtotal, 0));
    // MP-6 — comisión de servicio SUMADA por encima del subtotal de
    // entradas, nunca descontada de él (ver el comentario de Sale.total en
    // schema.prisma). Para MANUAL/Courtesy (applyServiceFee=false), total
    // sigue siendo exactamente ticketsSubtotal, sin cambios.
    const serviceFeeTotal = serviceFeeTiers ? round2(saleItemsData.reduce((sum, item) => sum + (item.serviceFeeSubtotal ?? 0), 0)) : null;
    const total = serviceFeeTiers ? round2(ticketsSubtotal + serviceFeeTotal) : ticketsSubtotal;

    // Ronda de endurecimiento — protección optimista: comparación exacta
    // contra lo que el comprador confirmó ver en el Wizard, ANTES de tocar
    // stock o crear cualquier fila. Cubre AMBAS causas posibles de un
    // desglose desactualizado (no sólo comisión, pese al nombre del
    // código de error): un organizador que cambió el precio de una
    // entrada, o un Developer que cambió los rangos de comisión — ambas
    // terminan afectando ticketsSubtotal/serviceFee/total, así que
    // comparar los tres alcanza para las dos. `expectedTotals` NUNCA se
    // usa para calcular nada, sólo para esta comparación — si no vino (o
    // vino incompleto), no hay nada que comparar y se sigue exactamente
    // como antes de este cambio (mismo comportamiento para MANUAL/
    // Courtesy, que nunca lo pasan).
    if (expectedTotals) {
        const expectedTicketsSubtotal = round2(Number(expectedTotals.ticketsSubtotal));
        const expectedServiceFee = round2(Number(expectedTotals.serviceFee));
        const expectedTotal = round2(Number(expectedTotals.total));
        const canCompare = Number.isFinite(expectedTicketsSubtotal) && Number.isFinite(expectedServiceFee) && Number.isFinite(expectedTotal);

        if (canCompare && (expectedTicketsSubtotal !== ticketsSubtotal || expectedServiceFee !== (serviceFeeTotal ?? 0) || expectedTotal !== total)) {
            logger.warn("createSaleForBuyer: el desglose confirmado por el comprador ya no coincide con el cálculo autoritativo", {
                eventId: event.id,
                expected: { ticketsSubtotal: expectedTicketsSubtotal, serviceFee: expectedServiceFee, total: expectedTotal },
                authoritative: { ticketsSubtotal, serviceFee: serviceFeeTotal, total },
            });
            throw new AppError(ErrorCodes.SERVICE_FEE_CHANGED, {
                details: { ticketsSubtotal, serviceFee: serviceFeeTotal, total },
            });
        }
    }

    const now = new Date();
    // MP-2.1 — toda Sale reserva stock, no sólo las de Mercado Pago: una
    // venta manual que por algún motivo tardara en confirmarse merece la
    // misma protección. Para el camino manual (createSale ->
    // confirm-by-buyer, hoy prácticamente inmediato) esto no cambia nada
    // observable — confirma muy por dentro de los 15 minutos.
    const stockReservedUntil = new Date(now.getTime() + STOCK_RESERVATION_TTL_MS);

    // MP-2.1 — reserva atómica bajo advisory lock: mismo mecanismo que ya
    // usaba confirmSaleService (ver acquireTicketTypeFunctionLock en
    // functionCapacity.service.js), aplicado ahora también acá. Un lock
    // por cada TicketType involucrado serializa ÚNICAMENTE los intentos
    // que compiten por el mismo tipo de entrada — nunca bloquea compras de
    // otros tipos de entrada o de otras funciones. Recién DESPUÉS de tomar
    // el lock se vuelve a leer disponibilidad (getUnavailableCount:
    // vendidas + reservas PENDING vigentes) y, si alcanza, se crea la Sale
    // en la MISMA transacción — así ningún otro request puede leer
    // disponibilidad "vieja" entre el chequeo y la creación (la carrera
    // clásica SELECT -> comprobar -> INSERT queda cerrada: sólo un
    // request a la vez puede estar "entre" el chequeo y el INSERT para un
    // mismo ticketTypeId+functionId).
    const sale = await prisma.$transaction(async (tx) => {
        const uniqueTicketTypeIds = [...new Set(saleItemsData.map((item) => item.ticketTypeId))];
        for (const ticketTypeId of uniqueTicketTypeIds) {
            await acquireTicketTypeFunctionLock(tx, ticketTypeId, eventFunction.id);
        }

        for (const item of saleItemsData) {
            const assignment = assignmentByTicketTypeId.get(item.ticketTypeId);
            const capacity = effectiveCapacity(assignment);
            const unavailable = await getUnavailableCount(tx, item.ticketTypeId, eventFunction.id, now);
            if (unavailable + item.quantity > capacity) {
                throw new AppError(ErrorCodes.INSUFFICIENT_STOCK, { details: { ticketTypeId: item.ticketTypeId } });
            }
        }

        return tx.sale.create({
            data: {
                status: "PENDING",
                origin,
                paymentMethod,
                checkoutIdempotencyKey,
                mercadoPagoExternalReference,
                stockReservedUntil,
                buyerId: buyer.id,
                eventId: event.id,
                functionId: eventFunction.id,
                total,
                ticketsSubtotal: serviceFeeTiers ? ticketsSubtotal : null,
                serviceFee: serviceFeeTiers ? serviceFeeTotal : null,
                // Mismo generador que TicketQr.secretEncrypted usa para el secret
                // del QR (crypto.randomBytes, no Math.random ni un cuid): esto va
                // a viajar en la URL del comprador y funciona como bearer token
                // para confirm-by-buyer/status, tiene que ser impredecible.
                publicRecoveryToken: crypto.randomBytes(32).toString("base64url"),
                // Ya normalizado (sin puntos/espacios/guiones) — nunca se guarda
                // el valor crudo que escribió el comprador.
                buyerDocument,
                items: { create: saleItemsData },
            },
            include: SALE_LIST_INCLUDE,
        });
    });

    logger.info("Sale created (PENDING, stock reserved)", {
        saleId: sale.id,
        eventId: event.id,
        buyerId: buyer.id,
        stockReservedUntil,
    });
    return sale;
}

const finalizeConfirmSale = (saleId, organizerUserId) => {
    logger.info("confirmSaleService completed", { saleId, organizerUserId });
    return { saleId, status: "CONFIRMED" };
};

// Camino autenticado (organizador/desarrollador operando en nombre de un
// usuario con cuenta real) — se mantiene por si algo interno lo necesita
// a futuro. El Wizard de compra público NUNCA pasa por acá.
export const createSaleService = async (clerkId, input) => {
    const buyer = await getUserByClerkId(clerkId);
    if (!buyer) throw new AppError(ErrorCodes.USER_NOT_FOUND);
    return createSaleForBuyer(buyer, input);
};

// Camino invitado — el único que usa el Wizard de compra público. `buyerInfo`
// es { firstName, lastName, email }, nunca un token de Clerk. `options` se
// reenvía tal cual a createSaleForBuyer — createSale (pago manual) nunca la
// pasa (paymentMethod/checkoutIdempotencyKey quedan en su default de
// siempre); sólo mercadoPagoCheckout.service.js (MP-2) la usa.
export const createGuestSaleService = async (buyerInfo, input, options = {}) => {
    // input.buyerDocument nunca se loguea crudo — sólo si vino presente.
    logger.info("createGuestSaleService entered", {
        buyerInfo,
        input: { ...input, buyerDocument: input?.buyerDocument ? "[present]" : undefined },
    });
    const buyer = await getOrCreateGuestBuyer(buyerInfo ?? {});
    const sale = await createSaleForBuyer(buyer, input, options);
    logger.info("createGuestSaleService completed", { saleId: sale.id, buyerId: buyer.id, organizationId: sale.organizationId, eventId: sale.eventId });
    return sale;
};

// Reconstruye la respuesta pública de una venta ya CONFIRMED (sale +
// tickets enriquecidos) desde cero, a partir de lo que ya persiste en la
// base — no de lo que se acaba de generar en memoria. Se usa tanto justo
// después de confirmar como cuando confirmSaleService encuentra una venta
// que YA estaba CONFIRMED (llamada repetida — ver más abajo): en ambos
// casos el resultado tiene que ser exactamente el mismo, así que es la
// misma función la que lo arma. El secret de cada QR se reconstruye al
// vuelo con decryptSecret (igual que getSaleStatusService) — nunca hay un
// qrToken guardado en texto plano del que depender.
async function buildConfirmedSaleResult(saleId) {
    const confirmedSale = await prisma.sale.findUnique({ where: { id: saleId }, include: SALE_LIST_INCLUDE });
    const tickets = await prisma.ticket.findMany({
        where: { saleId, deletedAt: null },
        select: {
            id: true,
            ticketNumber: true,
            status: true,
            ticketTypeId: true,
            ticketType: { select: { name: true } },
            qr: { select: { secretEncrypted: true } },
        },
        orderBy: { sequence: "asc" },
    });

    const enrichedTickets = tickets.map((ticket) => ({
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        status: ticket.status,
        ticketTypeId: ticket.ticketTypeId,
        ticketTypeName: ticket.ticketType?.name ?? "",
        eventTitle: confirmedSale.event.title,
        functionDate: confirmedSale.function.date,
        venue: confirmedSale.function.venue,
        qrToken: `${ticket.id}.${decryptSecret(ticket.qr.secretEncrypted)}`,
    }));

    // buyerEmail viaja aparte (no sólo dentro de `sale.buyer`): así el
    // frontend puede mostrar "te lo mandamos a este correo" sin tener que
    // saber de la forma completa de `sale` — y sin depender del estado
    // local de BuyerInfoStep, que no sobrevive a una recarga de página.
    return { sale: confirmedSale, tickets: enrichedTickets, buyerEmail: confirmedSale.buyer?.email ?? null };
}

// El corazón del flujo de pago manual (y, a futuro, del webhook de Mercado
// Pago — ver nota de compatibilidad en confirmedBy). Todo en UNA
// transacción: si cualquier paso falla, rollback completo, cero estados
// intermedios.
// `skipAutoEmail`: sólo lo usa courtesy.service.js para el delivery
// "Compartir" — una cortesía compartida por link nunca debe mandar un
// correo no pedido. Con `false` (default, todos los callers existentes)
// el comportamiento es exactamente el de siempre: sendSaleConfirmationEmail
// se dispara igual que hoy, sin excepciones.
export const confirmSaleService = async (clerkId, saleId, options = {}) => {
    // MP-3 / ronda "recuperación de pagos" — mercadoPagoPaymentId y
    // confirmationSource sólo los pasa mercadoPagoPaymentConfirmation.service.js
    // (núcleo compartido por el webhook y por la reconciliación), después de
    // verificar el payment server-to-server. Null para los dos callers
    // preexistentes (confirmSale/confirmSaleByBuyer, pago manual) —
    // comportamiento exacto de siempre para ellos. mercadoPagoPaymentId es
    // @unique en Sale: si alguna vez dos Sale intentaran reclamar el mismo
    // paymentId (no debería ser posible), Postgres lo rechaza con un P2002
    // en vez de dejar pasar una inconsistencia silenciosa.
    const { skipAutoEmail = false, mercadoPagoPaymentId = null, confirmationSource = null } = options;
    logger.info("confirmSaleService entered", { clerkId, saleId });
    const organizerUser = await getUserByClerkId(clerkId);
    if (!organizerUser) {
        logger.info("confirmSaleService failed: organizer user not found", { clerkId });
        throw new AppError(ErrorCodes.USER_NOT_FOUND);
    }

    const sale = await prisma.sale.findUnique({
        where: { id: saleId },
        include: {
            items: { include: { ticketType: true } },
            event: { include: { organization: true } },
            function: { select: { date: true, venue: true } },
        },
    });
    if (!sale || sale.deletedAt) throw new AppError(ErrorCodes.SALE_NOT_FOUND);
    // Mismo bypass que ya usa resendSaleConfirmationEmailService para
    // DEVELOPER — agregado acá para que courtesy.service.js pueda confirmar
    // una cortesía emitida por un DEVELOPER en una organización que no es la
    // suya (issueCourtesyService ya validó ese acceso antes de llegar acá).
    // No cambia nada para el resto de los callers: un ORGANIZER sigue sin
    // poder confirmar ventas ajenas, exactamente como siempre.
    const isDeveloper = organizerUser.role === "DEVELOPER";
    if (!isDeveloper && sale.event.organization.ownerId !== organizerUser.id) {
        logger.info("confirmSaleService failed: organizer does not own event organization", {
            saleId,
            organizerUserId: organizerUser.id,
            organizationOwnerId: sale.event.organization.ownerId,
        });
        // No se distingue de "no existe": no hace falta confirmarle a un
        // organizador ajeno que esa venta sí existe en otra organización.
        throw new AppError(ErrorCodes.SALE_NOT_FOUND);
    }

    // Idempotente para el caso de llamada repetida sobre una venta que YA
    // quedó CONFIRMED (reintentos del frontend, timeouts, polling, doble
    // solicitud, StrictMode, retries de red — ver
    // sendSaleConfirmationEmail.service.js): no se vuelve a crear ningún
    // ticket, sólo se reconstruye y devuelve el mismo resultado de éxito de
    // siempre. CANCELLED/EXPIRED siguen sin poder "confirmarse" — para esos
    // sigue tirando error más abajo, sin tocar ese comportamiento.
    if (sale.status === "CONFIRMED") {
        logger.info("confirmSaleService: sale already CONFIRMED, replaying result", { saleId });
        const replayed = await buildConfirmedSaleResult(sale.id);
        if (skipAutoEmail) {
            return { ...replayed, emailDeliveryStatus: sale.confirmationEmailStatus };
        }
        const emailOutcome = await sendSaleConfirmationEmail(sale.id);
        return { ...replayed, emailDeliveryStatus: emailOutcome.status ?? "PENDING" };
    }
    if (sale.status !== "PENDING") {
        logger.info("confirmSaleService failed: sale not pending", { saleId, status: sale.status });
        throw new AppError(ErrorCodes.SALE_NOT_PENDING);
    }

    const result = await prisma.$transaction(async (tx) => {
        // 1) Advisory lock por cada (ticketType, function) involucrado: serializa
        // únicamente las confirmaciones que compiten por el mismo stock, sin
        // bloquear confirmaciones de otros tipos de entrada. Se libera solo al
        // terminar la transacción (commit o rollback). MP-2.1: extraído a
        // functionCapacity.service.js#acquireTicketTypeFunctionLock (mismo
        // SQL exacto, sin cambio de comportamiento) para que
        // createSaleForBuyer pueda tomar el mismo lock al reservar stock.
        const uniqueTicketTypeIds = [...new Set(sale.items.map((item) => item.ticketTypeId))];
        for (const ticketTypeId of uniqueTicketTypeIds) {
            await acquireTicketTypeFunctionLock(tx, ticketTypeId, sale.functionId);
        }

        // 2) Update condicional atómico PENDING -> CONFIRMED: si dos requests
        // llegan a confirmar la misma venta al mismo tiempo, sólo uno encuentra
        // status: PENDING todavía y gana la carrera.
        const updated = await tx.sale.updateMany({
            where: { id: sale.id, status: "PENDING" },
            data: {
                status: "CONFIRMED",
                confirmedAt: new Date(),
                confirmedBy: organizerUser.id,
                mercadoPagoPaymentId,
                confirmationSource,
            },
        });
        if (updated.count === 0) {
            throw new AppError(ErrorCodes.SALE_ALREADY_PROCESSED);
        }

        // 3) Re-chequeo autoritativo de stock, ya bajo el advisory lock (el de
        // createSale era solo orientativo). Si otra venta se coló entre la
        // reserva y esta confirmación, se aborta y hace rollback completo
        // (incluye el update de status del paso 2).
        const assignments = await tx.functionTicketType.findMany({
            where: { functionId: sale.functionId, ticketTypeId: { in: uniqueTicketTypeIds } },
            include: { ticketType: { select: { name: true, quantity: true, maxPerPurchase: true } } },
        });
        const assignmentByTicketTypeId = new Map(assignments.map((a) => [a.ticketTypeId, a]));

        // Notificaciones Organizer — stock bajo/agotado (ver más abajo,
        // después de la transacción): capturado ACÁ, todavía bajo el
        // advisory lock por (ticketTypeId, functionId) tomado en el paso
        // 1, para que "antes"/"después" sea correcto incluso si otra venta
        // del MISMO tipo de entrada se confirma casi al mismo tiempo — un
        // cálculo hecho DESPUÉS de liberado el lock podría leer stock que
        // ya incluye esa otra venta y atribuir mal el cruce. `sold` acá es
        // el mismo conteo ya autoritativo que la línea de abajo usa para
        // decidir si la venta entra o no, así que no es una consulta
        // nueva, sólo se retiene.
        const stockSnapshots = [];

        for (const item of sale.items) {
            const assignment = assignmentByTicketTypeId.get(item.ticketTypeId);
            const capacity = assignment ? effectiveCapacity(assignment) : item.ticketType.quantity;
            // Re-chequeado acá también, no sólo en createSale: si el organizador
            // baja el maxPerPurchase de un tipo de entrada mientras la venta
            // sigue PENDING, la confirmación no debe dejarla pasar igual.
            const maxPerPurchase = assignment ? assignment.ticketType.maxPerPurchase : item.ticketType.maxPerPurchase;
            if (item.quantity > maxPerPurchase) {
                throw new AppError(ErrorCodes.MAX_PER_PURCHASE_EXCEEDED, { details: { ticketTypeId: item.ticketTypeId } });
            }
            const sold = await getSoldCount(tx, item.ticketTypeId, sale.functionId);
            if (sold + item.quantity > capacity) {
                throw new AppError(ErrorCodes.INSUFFICIENT_STOCK, { details: { ticketTypeId: item.ticketTypeId } });
            }
            stockSnapshots.push({
                ticketTypeId: item.ticketTypeId,
                ticketTypeName: assignment ? assignment.ticketType.name : item.ticketType.name,
                capacity,
                availableBefore: Math.max(capacity - sold, 0),
                availableAfter: Math.max(capacity - sold - item.quantity, 0),
            });
        }

        // 4) Generar Tickets + TicketQr, uno por unidad comprada — en batch
        // (createMany), no un create() por ticket. Con ventas grandes (ej. un
        // grupo de 40+ entradas), crear una por una en un loop secuencial
        // significa decenas de round-trips a la base dentro de la misma
        // transacción y termina superando el timeout de $transaction (5s por
        // default en Prisma) bajo la latencia real de un pooler — se
        // reprodujo en pruebas (P2028) antes de este cambio. `nextval()` se
        // pide una sola vez para TODAS las unidades de la venta
        // (generate_series), no una vez por ticket.
        const totalQuantity = sale.items.reduce((sum, item) => sum + item.quantity, 0);
        const sequenceRows = await tx.$queryRawUnsafe(
            `SELECT nextval('tickets_sequence_seq') AS seq FROM generate_series(1, $1)`,
            totalQuantity
        );
        const sequences = sequenceRows.map((row) => Number(row.seq));

        const ticketRows = [];
        const qrRows = [];
        const tickets = [];
        let sequenceIndex = 0;

        for (const item of sale.items) {
            for (let i = 0; i < item.quantity; i += 1) {
                const sequence = sequences[sequenceIndex++];
                const ticketNumber = buildTicketNumber(sequence);
                const secret = crypto.randomBytes(24).toString("base64url");
                const ticketId = crypto.randomUUID();

                ticketRows.push({
                    id: ticketId,
                    sequence,
                    ticketNumber,
                    status: "ACTIVE",
                    saleId: sale.id,
                    eventId: sale.eventId,
                    functionId: sale.functionId,
                    ticketTypeId: item.ticketTypeId,
                    buyerId: sale.buyerId,
                    ownerId: sale.buyerId, // hoy siempre igual al buyer; separado para permitir transferencias a futuro
                    origin: sale.origin, // denormalizado desde la Sale — ver comentario en schema.prisma
                });
                qrRows.push({
                    id: crypto.randomUUID(),
                    ticketId,
                    secretEncrypted: encryptSecret(secret),
                });

                // El secret en claro solo existe acá, en memoria, para devolverlo
                // una vez en la respuesta de esta operación. Nunca se persiste.
                tickets.push({ id: ticketId, ticketNumber, status: "ACTIVE", ticketTypeId: item.ticketTypeId, qrToken: `${ticketId}.${secret}` });
            }
        }

        await tx.ticket.createMany({ data: ticketRows });
        await tx.ticketQr.createMany({ data: qrRows });

        return { saleId: sale.id, tickets, stockSnapshots };
    });

    logger.info("Sale confirmed", {
        saleId: sale.id,
        confirmedBy: organizerUser.id,
        ticketCount: result.tickets.length,
    });

    // Alertas Developer — sólo para ventas REALES (origin=SALE, nunca
    // COURTESY: una cortesía nunca es "primera venta" ni cuenta para pico
    // de volumen, mismo criterio que el resto del proyecto separa
    // Cortesías de "ventas reales"). Bloque enteramente best-effort — un
    // error acá NUNCA puede revertir ni afectar la confirmación ya
    // committeada arriba, por eso todo el bloque va en su propio
    // try/catch, además de que sendDeveloperAlert ya nunca lanza por sí
    // solo (ver informe de entrega, sección "Best-effort obligatorio").
    if (sale.origin === "SALE") {
        try {
            const organizationId = sale.event.organizationId;
            const organizationName = sale.event.organization.name;
            const config = await getDeveloperAlertConfigOrDefaults();

            // D) Primera venta CONFIRMED de la organización — concurrent-safe
            // por construcción (ver informe de entrega, sección "Primera
            // venta confirmada"): este count() corre DESPUÉS de que la
            // transacción de arriba ya hizo commit, así que Postgres
            // garantiza que cualquier otra confirmación cuyo propio commit
            // haya ocurrido antes YA es visible acá. Sólo puede haber una
            // ejecución que vea count===1 para una organización dada — la
            // que de verdad commiteó primero.
            const confirmedSalesCount = await prisma.sale.count({
                where: { status: "CONFIRMED", origin: "SALE", event: { organizationId } },
            });
            if (confirmedSalesCount === 1) {
                const alertResult = await sendDeveloperAlert(DeveloperAlertType.FIRST_CONFIRMED_SALE, {
                    organizationId,
                    organizationName,
                    saleId: sale.id,
                    confirmedAt: new Date(),
                });
                if (!alertResult.sent) {
                    logger.warn("confirmSaleService: no se pudo enviar la alerta Developer de primera venta confirmada", { saleId: sale.id, reason: alertResult.reason });
                }
            }

            // 2B) Cantidad excepcional de entradas en una única compra —
            // datos autoritativos de la Sale ya confirmada (sale.items),
            // nunca nada mandado por el frontend.
            const totalQuantity = sale.items.reduce((sum, item) => sum + item.quantity, 0);
            if (totalQuantity > config.highSaleQuantityThreshold) {
                const alertResult = await sendDeveloperAlert(DeveloperAlertType.HIGH_QUANTITY_SALE, {
                    organizationId,
                    organizationName,
                    saleId: sale.id,
                    eventId: sale.eventId,
                    quantity: totalQuantity,
                    threshold: config.highSaleQuantityThreshold,
                });
                if (!alertResult.sent) {
                    logger.warn("confirmSaleService: no se pudo enviar la alerta Developer de compra con cantidad excepcional", { saleId: sale.id, reason: alertResult.reason });
                }
            }

            // 2D) Pico de ventas CONFIRMED de la organización en la ventana
            // configurada — con cooldown persistente (ver
            // tryClaimDeveloperAlertCooldown): no se manda un email por
            // cada venta adicional mientras el volumen se mantenga alto.
            const windowStart = new Date(Date.now() - config.salesVolumeWindowMinutes * 60 * 1000);
            const recentConfirmedCount = await prisma.sale.count({
                where: { status: "CONFIRMED", origin: "SALE", confirmedAt: { gte: windowStart }, event: { organizationId } },
            });
            if (recentConfirmedCount >= config.salesVolumeWindowCount) {
                const claimed = await tryClaimDeveloperAlertCooldown(`${DeveloperAlertType.SALES_VOLUME_SPIKE}:${organizationId}`, config.alertCooldownMinutes);
                if (claimed) {
                    const alertResult = await sendDeveloperAlert(DeveloperAlertType.SALES_VOLUME_SPIKE, {
                        organizationId,
                        organizationName,
                        count: recentConfirmedCount,
                        windowMinutes: config.salesVolumeWindowMinutes,
                        threshold: config.salesVolumeWindowCount,
                    });
                    if (!alertResult.sent) {
                        logger.warn("confirmSaleService: no se pudo enviar la alerta Developer de pico de ventas", { organizationId, reason: alertResult.reason });
                    }
                }
            }
        } catch (err) {
            logger.error(err, { context: "confirmSaleService: fallo inesperado evaluando alertas Developer (la venta ya confirmada arriba no se ve afectada)", saleId: sale.id });
        }
    }

    // Notificaciones Organizer — mismo criterio best-effort/never-throw que
    // el bloque de Alertas Developer de arriba (su propio try/catch, corre
    // DESPUÉS del commit): un fallo acá nunca puede revertir ni afectar la
    // venta ya confirmada. Sólo origin=SALE — una Cortesía nunca es una
    // "venta confirmada" para el organizador (mismo criterio que Alertas
    // Developer separa Cortesías de ventas reales, ver el informe de
    // entrega).
    //
    // Idempotencia de "venta confirmada": NO usa ningún claim nuevo — la
    // transacción de arriba ya solo llega hasta acá para la ÚNICA llamada
    // que de verdad ganó la transición atómica PENDING -> CONFIRMED (una
    // segunda llamada concurrente/repetida entra por la rama "ya estaba
    // CONFIRMED" al principio de esta función y nunca llega a este bloque)
    // — ver el informe de entrega, sección "Deduplicación".
    if (sale.origin === "SALE") {
        try {
            const organizationId = sale.event.organizationId;
            const organizerEmail = sale.event.organization.email;
            const settings = await getOrganizerNotificationSettingsOrDefaults(organizationId);
            const totalQuantity = sale.items.reduce((sum, item) => sum + item.quantity, 0);
            const ticketSummary = sale.items.map((item) => `${item.quantity}x ${item.ticketType.name}`).join(", ");

            if (settings.saleConfirmedEnabled && organizerEmail) {
                const notifyResult = await sendOrganizerNotification(OrganizerNotificationType.SALE_CONFIRMED, {
                    to: organizerEmail,
                    eventTitle: sale.event.title,
                    functionDate: sale.function.date,
                    venue: sale.function.venue,
                    ticketCount: totalQuantity,
                    ticketSummary,
                    total: Number(sale.total),
                });
                if (!notifyResult.sent) {
                    logger.warn("confirmSaleService: no se pudo enviar la notificación de venta confirmada", { saleId: sale.id, reason: notifyResult.reason });
                }
            }

            // Hito de ventas — POR EVENTO (nunca sumado entre eventos de la
            // misma organización, aunque X sea una preferencia a nivel
            // organización — pedido explícito: dos eventos de la misma
            // organización acumulan el hito cada uno por separado). Sigue
            // contando sólo entradas origin=SALE en estado "vendido"
            // (SOLD_TICKET_STATUSES, mismo criterio que el resto de este
            // archivo — Cortesías NUNCA suman acá, sin cambios respecto de
            // la versión anterior). Un único post-commit count() acotado a
            // eventId (mismo razonamiento de seguridad que
            // FIRST_CONFIRMED_SALE más arriba: Postgres garantiza que
            // cualquier commit anterior ya es visible acá) da el total
            // ACTUAL de ESTE evento; el total ANTES de esta venta se deriva
            // restando totalQuantity, sin una segunda consulta. Una sola
            // venta puede cruzar más de un múltiplo del mismo evento (ej.
            // 80 -> 230 con salesMilestoneCount=100 cruza 100 Y 200) — cada
            // múltiplo cruzado se reclama y notifica por separado,
            // deduplicado de forma persistente vía OrganizerNotificationClaim
            // con key organización+evento+hito (necesario acá: a diferencia
            // de "venta confirmada", este número es compartido entre TODAS
            // las ventas de ESE evento, que no están serializadas entre sí
            // por ningún lock — dos ventas de tipos de entrada distintos
            // del mismo evento sí pueden confirmarse en paralelo).
            if (settings.salesMilestoneEnabled && organizerEmail && settings.salesMilestoneCount > 0) {
                const soldCountAfter = await prisma.ticket.count({
                    where: { status: { in: SOLD_TICKET_STATUSES }, origin: "SALE", eventId: sale.eventId },
                });
                const soldCountBefore = soldCountAfter - totalQuantity;
                const crossedMilestones = computeCrossedStepMilestones(soldCountBefore, soldCountAfter, settings.salesMilestoneCount);
                for (const milestone of crossedMilestones) {
                    const claimed = await tryClaimOrganizerNotification(`sales-milestone:${organizationId}:${sale.eventId}:${milestone}`);
                    if (claimed) {
                        const notifyResult = await sendOrganizerNotification(OrganizerNotificationType.SALES_MILESTONE, {
                            to: organizerEmail,
                            eventTitle: sale.event.title,
                            milestone,
                            soldCount: soldCountAfter,
                        });
                        if (!notifyResult.sent) {
                            logger.warn("confirmSaleService: no se pudo enviar la notificación de hito de ventas", { eventId: sale.eventId, milestone, reason: notifyResult.reason });
                        }
                    }
                }
            }

            // Stock bajo (configurable) / Agotado (OBLIGATORIA, nunca
            // depende de settings) — usa EXACTAMENTE los snapshots
            // capturados dentro de la transacción de arriba (paso 3),
            // todavía bajo el advisory lock por (ticketTypeId, functionId):
            // calcularlo acá de nuevo, ya liberado el lock, podría leer
            // stock que otra venta concurrente del MISMO tipo de entrada ya
            // modificó, y atribuir mal (o duplicar) un cruce de umbral. Si
            // más adelante el organizador aumenta la capacidad y el tipo de
            // entrada vuelve a cruzar el umbral/agotarse, esto vuelve a
            // avisar solo — no hay ningún estado persistido que lo impida
            // (ver el informe de entrega, sección "Reposición de stock").
            for (const { ticketTypeId, ticketTypeName, capacity, availableBefore, availableAfter } of result.stockSnapshots) {
                if (hasJustSoldOut(availableBefore, availableAfter)) {
                    const notifyResult = await sendOrganizerNotification(OrganizerNotificationType.SOLD_OUT, {
                        to: organizerEmail,
                        eventTitle: sale.event.title,
                        ticketTypeName,
                        functionDate: sale.function.date,
                        venue: sale.function.venue,
                    });
                    if (!notifyResult.sent) {
                        logger.warn("confirmSaleService: no se pudo enviar la notificación de entradas agotadas", { saleId: sale.id, ticketTypeId, reason: notifyResult.reason });
                    }
                }

                if (settings.lowStockEnabled && organizerEmail && capacity > 0) {
                    const thresholdCount = Math.floor((capacity * settings.lowStockPercent) / 100);
                    if (hasCrossedThresholdDown(availableBefore, availableAfter, thresholdCount)) {
                        const notifyResult = await sendOrganizerNotification(OrganizerNotificationType.LOW_STOCK, {
                            to: organizerEmail,
                            eventTitle: sale.event.title,
                            ticketTypeName,
                            functionDate: sale.function.date,
                            venue: sale.function.venue,
                            remaining: availableAfter,
                            percent: settings.lowStockPercent,
                        });
                        if (!notifyResult.sent) {
                            logger.warn("confirmSaleService: no se pudo enviar la notificación de stock bajo", { saleId: sale.id, ticketTypeId, reason: notifyResult.reason });
                        }
                    }
                }
            }
        } catch (err) {
            logger.error(err, { context: "confirmSaleService: fallo inesperado evaluando Notificaciones Organizer (la venta ya confirmada arriba no se ve afectada)", saleId: sale.id });
        }
    }

    // Se reconstruye con la misma función que usa el camino "ya estaba
    // CONFIRMED" en vez de armar la respuesta a mano acá con lo que
    // devolvió la transacción — así los dos caminos siempre devuelven
    // exactamente la misma forma, sin dos versiones de esta lógica para
    // mantener sincronizadas.
    const confirmedResult = await buildConfirmedSaleResult(sale.id);

    if (skipAutoEmail) {
        return { ...confirmedResult, emailDeliveryStatus: "PENDING" };
    }

    // Nunca dentro de la transacción de arriba (ya cerrada): Resend es una
    // llamada de red a un servicio externo, no puede formar parte de un
    // rollback de Postgres. Si el email falla, sendSaleConfirmationEmail lo
    // deja registrado como FAILED y devuelve sin lanzar — la compra ya
    // confirmada nunca se revierte ni se le muestra como fallida al
    // comprador por esto.
    const emailOutcome = await sendSaleConfirmationEmail(sale.id);

    return { ...confirmedResult, emailDeliveryStatus: emailOutcome.status ?? "PENDING" };
};

// Solo se puede cancelar una venta PENDING — nunca una ya confirmada (eso
// requeriría reembolso, fuera de alcance de esta fase). Permitido tanto al
// comprador (se arrepiente) como al organizador (rechaza la reserva).
export const cancelSaleService = async (clerkId, saleId) => {
    const user = await getUserByClerkId(clerkId);
    if (!user) throw new AppError(ErrorCodes.USER_NOT_FOUND);

    const sale = await prisma.sale.findUnique({
        where: { id: saleId },
        include: { event: { include: { organization: true } } },
    });
    if (!sale || sale.deletedAt) throw new AppError(ErrorCodes.SALE_NOT_FOUND);

    const isBuyer = sale.buyerId === user.id;
    const isOrganizer = sale.event.organization.ownerId === user.id;
    if (!isBuyer && !isOrganizer) throw new AppError(ErrorCodes.SALE_NOT_FOUND);

    const updated = await prisma.sale.updateMany({
        where: { id: saleId, status: "PENDING" },
        data: { status: "CANCELLED" },
    });
    if (updated.count === 0) throw new AppError(ErrorCodes.SALE_NOT_PENDING);

    logger.info("Sale cancelled", { saleId, cancelledBy: user.id });
    return prisma.sale.findUnique({ where: { id: saleId }, include: SALE_LIST_INCLUDE });
};

// Si se pide un `eventId` puntual, siempre se devuelve (aunque esté
// archivado — ej. el detalle del Historial de Eventos necesita poder leer
// sus ventas finales). El filtro `archivedAt: null` sólo aplica al listado
// "todos mis eventos" (pantalla operativa de Ventas): ese es el que nunca
// debe mostrar ventas de un evento que ya pasó al Historial.
export const listSalesOrganizerService = async (clerkId, filters = {}) => {
    const user = await getUserByClerkId(clerkId);
    if (!user) return [];

    const organization = await getOrganizationByOwner(user.id);
    if (!organization) return [];

    if (!filters.eventId) {
        await runArchiveSelfHeal(prisma, { organizationId: organization.id });
    }

    const where = {
        event: {
            organizationId: organization.id,
            ...(filters.eventId ? {} : { archivedAt: null }),
        },
        deletedAt: null,
        // "Ventas" es exclusivamente ingresos reales — las cortesías tienen
        // su propio listado (courtesy.service.js#listCourtesiesService) y
        // nunca deben aparecer acá mezcladas con precio $0.
        origin: "SALE",
    };

    if (filters.status) where.status = filters.status;
    if (filters.eventId) where.eventId = filters.eventId;

    if (filters.dateFrom || filters.dateTo) {
        where.createdAt = {};
        if (filters.dateFrom) where.createdAt.gte = new Date(filters.dateFrom);
        if (filters.dateTo) where.createdAt.lte = new Date(filters.dateTo);
    }

    // Mismo criterio que listTicketsOrganizerService (ticket.service.js):
    // nombre/apellido/email del comprador + DNI normalizado de la venta
    // puntual (Sale.buyerDocument, no un campo del comprador) en un único OR
    // — nunca una segunda búsqueda paralela.
    if (filters.buyer?.trim()) {
        const term = filters.buyer.trim();
        const normalizedDocument = normalizeBuyerDocument(term);
        where.OR = [
            { buyer: { firstName: { contains: term, mode: "insensitive" } } },
            { buyer: { lastName: { contains: term, mode: "insensitive" } } },
            { buyer: { email: { contains: term, mode: "insensitive" } } },
            ...(normalizedDocument ? [{ buyerDocument: { contains: normalizedDocument } }] : []),
        ];
    }

    return prisma.sale.findMany({ where, include: SALE_LIST_INCLUDE, orderBy: { createdAt: "desc" } });
};

export const listSalesBuyerService = async (clerkId) => {
    const user = await getUserByClerkId(clerkId);
    if (!user) return [];

    return prisma.sale.findMany({
        where: { buyerId: user.id, deletedAt: null },
        include: SALE_LIST_INCLUDE,
        orderBy: { createdAt: "desc" },
    });
};

// Recuperación por timeout del Wizard invitado (usePublishFlow) Y también
// consulta usada para reconstruir la pantalla de éxito cuando el estado de
// React no sobrevivió (recarga de página, o el día de mañana un redirect
// real de Mercado Pago). Sin sesión no hay forma de listar "mis ventas" —
// por eso este endpoint se resuelve por publicRecoveryToken (nunca por el
// `id` interno: ese es la clave primaria, no un secreto — aparece en URLs
// de organizador, en logs, en relaciones; el token es aleatorio y no sirve
// para nada más que esto). Mientras la venta no esté CONFIRMED no devuelve
// nada del detalle de la compra (nunca nombre, email, ni tickets); recién
// confirmada trae exactamente lo mismo que ya devuelve confirmSaleService
// en su respuesta original, para que la pantalla de éxito pueda
// renderizarse igual sin importar por qué camino llegó el dato. El secret
// de cada QR se reconstruye acá al vuelo (decryptSecret) — nunca se
// persiste en texto plano, así que no hay nada "cacheado" que filtrar.
export const getSaleStatusService = async (recoveryToken) => {
    if (!recoveryToken) throw new AppError(ErrorCodes.SALE_NOT_FOUND);

    const sale = await prisma.sale.findUnique({
        where: { publicRecoveryToken: recoveryToken },
        select: {
            id: true,
            status: true,
            deletedAt: true,
            confirmationEmailStatus: true,
            buyer: { select: { email: true } },
            event: { select: { title: true } },
            function: { select: { date: true, venue: true } },
            tickets: {
                where: { deletedAt: null },
                select: {
                    id: true,
                    ticketNumber: true,
                    status: true,
                    ticketTypeId: true,
                    ticketType: { select: { name: true } },
                    qr: { select: { secretEncrypted: true } },
                },
            },
        },
    });
    if (!sale || sale.deletedAt) throw new AppError(ErrorCodes.SALE_NOT_FOUND);

    if (sale.status !== "CONFIRMED") {
        return { id: sale.id, status: sale.status };
    }

    // Botón de arrepentimiento — ventana informativa de 24h post-devolución
    // (ver getWithdrawalReturnInfoForTickets/isWithinWithdrawalReturnWindow,
    // withdrawalRequest.service.js). Resuelto acá, al CONSULTAR — nunca un
    // cron/job: `now` es un único instante compartido por el cálculo de
    // returnedAt y por el filtro de abajo, así que ambos siempre coinciden.
    // Un ticket CANCELLED por CUALQUIER OTRO motivo (ticketAdmin admin
    // panel, etc.) nunca tiene returnedAt — sigue apareciendo exactamente
    // como siempre, sin ventana ni vencimiento.
    const cancelledTicketIds = sale.tickets.filter((t) => t.status === "CANCELLED").map((t) => t.id);
    const returnInfoByTicketId = await getWithdrawalReturnInfoForTickets(cancelledTicketIds);
    const now = new Date();

    const tickets = [];
    for (const ticket of sale.tickets) {
        const returnedAt = returnInfoByTicketId.get(ticket.id) ?? null;
        // Ventana vencida (>=24h) — deja de aparecer en este panel, pero
        // nunca se borra ni se toca nada en la base (ver el informe de
        // entrega): el ticket, su QR, TicketAuditLog y WithdrawalRequest
        // siguen existiendo tal cual, sólo se omite de ESTA respuesta.
        if (returnedAt && !isWithinWithdrawalReturnWindow(returnedAt, now)) continue;

        tickets.push({
            id: ticket.id,
            ticketNumber: ticket.ticketNumber,
            status: ticket.status,
            ticketTypeId: ticket.ticketTypeId,
            ticketTypeName: ticket.ticketType?.name ?? "",
            eventTitle: sale.event.title,
            functionDate: sale.function.date,
            venue: sale.function.venue,
            qrToken: `${ticket.id}.${decryptSecret(ticket.qr.secretEncrypted)}`,
            returnedAt,
            returnWindowExpiresAt: returnedAt
                ? new Date(returnedAt.getTime() + WITHDRAWAL_RETURN_VISIBILITY_HOURS * 60 * 60 * 1000)
                : null,
        });
    }

    return {
        id: sale.id,
        status: sale.status,
        tickets,
        buyerEmail: sale.buyer?.email ?? null,
        emailDeliveryStatus: sale.confirmationEmailStatus,
    };
};

// Query real de "Recuperar mis entradas", separada de recoverSalesService
// para que saleRecoveryVerification.service.js pueda reusarla con valores ya
// normalizados (antes de mandar el código, y de nuevo recién después de
// verificarlo) sin duplicar el where/select ni revalidar formato dos veces.
async function findConfirmedRecoverableSales(normalizedEmail, normalizedDocument) {
    const sales = await prisma.sale.findMany({
        where: {
            status: "CONFIRMED",
            deletedAt: null,
            buyerDocument: normalizedDocument,
            buyer: { email: normalizedEmail },
            // Ventas de antes de que existiera publicRecoveryToken no se
            // pueden "abrir" después (no hay token al que mandarlas) — se
            // excluyen acá en vez de devolver un resultado roto. No es una
            // regresión: esas ventas ya entregaron sus entradas en su
            // momento, y esta pantalla es una funcionalidad nueva.
            publicRecoveryToken: { not: null },
        },
        select: {
            publicRecoveryToken: true,
            createdAt: true,
            buyer: { select: { firstName: true } },
            event: { select: { title: true } },
            function: { select: { date: true, venue: true } },
            tickets: { where: { deletedAt: null }, select: { id: true } },
        },
        orderBy: { createdAt: "desc" },
    });

    return sales
        .filter((sale) => sale.tickets.length > 0)
        .map((sale) => ({
            recoveryToken: sale.publicRecoveryToken,
            eventTitle: sale.event.title,
            functionDate: sale.function.date,
            venue: sale.function.venue,
            ticketCount: sale.tickets.length,
            buyerFirstName: sale.buyer?.firstName ?? "",
        }));
}

export { findConfirmedRecoverableSales };

// Búsqueda interna de "Recuperar mis entradas" — email + DNI sólo
// LOCALIZAN una compra propia, nunca autorizan verla: nunca se llama desde
// un controller directamente. saleRecoveryVerification.service.js es el
// único punto que decide qué hacer con este resultado (mandar un código de
// 6 dígitos si hay match, y recién devolver estos datos al comprador después
// de que ese código se verifique) — ver requestSaleRecoveryCodeService /
// verifySaleRecoveryCodeService. A diferencia de publicRecoveryToken (un
// secreto de alta entropía que sólo conoce quien compró), acá la prueba de
// posesión es "conocer dos datos personales exactos a la vez", así que el
// resultado nunca distingue si falló el email, el DNI, o ambos: siempre la
// misma lista (vacía o no), nunca un error que revele cuál de los dos
// estuvo mal.
export const recoverSalesService = async ({ email, buyerDocument }) => {
    const normalizedEmail = email?.trim().toLowerCase();
    if (!normalizedEmail || !buyerDocument?.trim()) {
        throw new AppError(ErrorCodes.RECOVER_INFO_REQUIRED);
    }
    if (!isValidEmail(normalizedEmail)) {
        throw new AppError(ErrorCodes.GUEST_BUYER_INVALID_EMAIL);
    }
    const normalizedDocument = normalizeBuyerDocument(buyerDocument);
    if (!isValidBuyerDocument(normalizedDocument)) {
        throw new AppError(ErrorCodes.GUEST_BUYER_INVALID_DOCUMENT);
    }

    const sales = await findConfirmedRecoverableSales(normalizedEmail, normalizedDocument);

    // Nunca se loguea email/DNI (son justo el dato sensible de esta
    // búsqueda) — sólo cuántos resultados dio.
    logger.info("recoverSalesService completed", { matchCount: sales.length });

    return sales;
};

// Botón "Reenviar correo" de la pantalla de recuperación — mismo modelo de
// autorización que confirm-by-buyer/status (conocer el publicRecoveryToken
// alcanza, sin sesión). Es una acción manual explícita (alguien apretó el
// botón), así que usa force:true: a diferencia del auto-trigger de
// confirmSaleService, este llamado SÍ tiene que reclamar y reenviar de
// verdad aunque la venta ya esté SENT — si no, "Reenviar" queda inutilizado
// para siempre en cuanto el primer envío automático se marca SENT (bug
// reportado: el botón decía "reenviado" sin haber llamado a Resend). Nunca
// genera tickets nuevos ni toca la venta — sólo intenta el envío.
export const resendConfirmationEmailByTokenService = async (recoveryToken) => {
    if (!recoveryToken) throw new AppError(ErrorCodes.SALE_NOT_FOUND);

    const sale = await prisma.sale.findUnique({
        where: { publicRecoveryToken: recoveryToken },
        select: { id: true, status: true, deletedAt: true },
    });
    if (!sale || sale.deletedAt) throw new AppError(ErrorCodes.SALE_NOT_FOUND);
    if (sale.status !== "CONFIRMED") throw new AppError(ErrorCodes.SALE_NOT_CONFIRMED);

    // sendSaleConfirmationEmail() nunca lanza (ver su propio comentario: un
    // email caído no puede tumbar una venta ya confirmada), así que acá es
    // donde hay que mirar el resultado explícitamente. `result.status` es
    // siempre "FAILED" para este intento puntual si Resend no pudo mandar
    // el correo — sin importar que confirmationEmailStatus haya quedado en
    // "SENT" en la base (ver markEmailFailed: preserva SENT si ya lo estaba
    // antes de este reenvío, para no borrar el rastro de una entrega previa
    // real). El único caso "no reclamable" que sigue existiendo con force
    // es un envío realmente en curso en este momento (SENDING fresco).
    const result = await sendSaleConfirmationEmail(sale.id, { force: true });
    if (result.status === "FAILED") {
        throw new AppError(ErrorCodes.SALE_EMAIL_RESEND_FAILED);
    }
    return { emailDeliveryStatus: result.status ?? "PENDING" };
};

// Botón "Descargar PDF" de la pantalla "Compra encontrada" — mismo modelo
// de autorización que resendConfirmationEmailByTokenService (conocer el
// publicRecoveryToken alcanza, sin sesión). Arma EXACTAMENTE el mismo PDF
// que ya se adjunta al email de confirmación: reusa getSaleEmailData (junta
// tickets + desencripta los secrets de QR), buildTicketQrImages y
// buildTicketsPdfBuffer tal cual — nunca genera tickets ni QR nuevos, sólo
// vuelve a renderizar el mismo PDF a partir de los datos ya existentes.
export const getSalePdfByTokenService = async (recoveryToken) => {
    if (!recoveryToken) throw new AppError(ErrorCodes.SALE_NOT_FOUND);

    const sale = await prisma.sale.findUnique({
        where: { publicRecoveryToken: recoveryToken },
        select: { id: true, status: true, deletedAt: true },
    });
    if (!sale || sale.deletedAt) throw new AppError(ErrorCodes.SALE_NOT_FOUND);
    if (sale.status !== "CONFIRMED") throw new AppError(ErrorCodes.SALE_NOT_CONFIRMED);

    const data = await getSaleEmailData(sale.id);
    if (!data || data.tickets.length === 0) throw new AppError(ErrorCodes.SALE_NOT_FOUND);

    const qrImages = await buildTicketQrImages(data.tickets);
    const pdfBuffer = await buildTicketsPdfBuffer({
        eventTitle: data.eventTitle,
        venue: data.venue,
        functionDate: data.functionDate,
        tickets: data.tickets,
        qrImages,
    });

    return { pdfBuffer, fileName: `entradas-pasecultural-${data.saleId}.pdf` };
};

// Botón de arrepentimiento — query real de "qué compras puede elegir esta
// persona", separada del service de verificación (withdrawalRequestVerification.service.js
// la reusa tal cual, con valores ya normalizados) por el mismo motivo que
// findConfirmedRecoverableSales: nunca se llama desde un controller
// directamente, sólo después de un OTP verificado.
//
// Elegibilidad TÉCNICA, nunca legal (ver el informe de entrega — el bloque
// legal de PaseCultural todavía no está definido): CONFIRMED (nunca
// PENDING/CANCELLED/EXPIRED — esas nunca llegaron a completarse), origin
// SALE (nunca COURTESY, mismo criterio que el resto del proyecto separa
// cortesías de "ventas reales"), y al menos un Ticket que no esté YA
// REFUNDED (si todos ya se revirtieron por Mercado Pago, no tiene sentido
// ofrecer una solicitud nueva sobre algo que ya se resolvió del lado
// financiero real).
//
// `existingRequestStatus` viaja ya resuelto (REQUESTED/CONTACTED si hay
// una solicitud activa, null si no) para que el frontend pueda mostrar el
// estado existente en vez de un botón "Solicitar" — ver createWithdrawalRequestService,
// que igual vuelve a validar esto de forma autoritativa antes de crear
// nada (nunca confía en que el frontend haya visto este resultado a
// tiempo). Cierre del ciclo — `withdrawalRequestId` viaja también (sólo
// cuando hay una solicitud activa) para que "Descartar solicitud"/"Volver
// a contactar" tengan qué mostrar/accionar sin una llamada aparte;
// `contact` reutiliza EXACTAMENTE buildOrganizationContact (nunca
// reimplementado acá) y, mismo criterio de privacidad que
// createWithdrawalRequestService, sólo se calcula cuando YA existe una
// solicitud — nunca se expone el contacto del organizador para una compra
// sin solicitud todavía.
export async function findWithdrawalEligibleSales(normalizedEmail, normalizedDocument) {
    const sales = await prisma.sale.findMany({
        where: {
            status: "CONFIRMED",
            origin: "SALE",
            deletedAt: null,
            buyerDocument: normalizedDocument,
            buyer: { email: normalizedEmail },
            publicRecoveryToken: { not: null },
        },
        select: {
            publicRecoveryToken: true,
            createdAt: true,
            event: { select: { title: true, organization: { select: { phone: true, phoneVerifiedAt: true, email: true } } } },
            function: { select: { date: true, venue: true } },
            tickets: { where: { deletedAt: null }, select: { status: true } },
            withdrawalRequests: {
                where: { status: { in: ["REQUESTED", "CONTACTED"] } },
                select: { id: true, status: true },
                take: 1,
            },
        },
        orderBy: { createdAt: "desc" },
    });

    return sales
        .filter((sale) => sale.tickets.some((t) => t.status !== "REFUNDED"))
        .map((sale) => {
            const activeRequest = sale.withdrawalRequests[0] ?? null;
            return {
                saleToken: sale.publicRecoveryToken,
                eventTitle: sale.event.title,
                functionDate: sale.function.date,
                venue: sale.function.venue,
                purchasedAt: sale.createdAt,
                ticketCount: sale.tickets.length,
                existingRequestStatus: activeRequest?.status ?? null,
                withdrawalRequestId: activeRequest?.id ?? null,
                contact: activeRequest ? buildOrganizationContact(sale.event.organization, sale.event.title) : null,
            };
        });
}
