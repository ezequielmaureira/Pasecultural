import crypto from "node:crypto";
import prisma from "../config/prisma.js";
import { decryptSecret } from "../config/qrEncryption.js";
import { getFunctionCounters } from "./functionCapacity.service.js";
import { resolveScannerAccess } from "./scannerAccess.service.js";
import { logger } from "../logging/logger.js";

const RESULT_MESSAGES = {
    VALID: "Entrada válida.",
    ALREADY_USED: "La entrada ya fue utilizada.",
    CANCELLED: "La entrada fue cancelada.",
    NOT_FOUND: "Entrada inexistente.",
    WRONG_EVENT: "Esta entrada no corresponde a este evento o función.",
};

// maxWait/timeout explícitos (default de Prisma: 2000ms/5000ms). Auditoría
// de concurrencia (ver TicketAuditLog/CheckIn) comprobó que el updateMany
// condicional de más abajo YA garantiza que sólo un escaneo gane la carrera
// —nunca se detectó un doble VALID, con hasta 20 escaneos simultáneos sobre
// el mismo ticket—, pero bajo ESE caso patológico (20 escaneos exactos al
// mismo ticket a la vez; en un evento real cada scanner escanea un ticket
// distinto, sin esta contención) varias transacciones no llegaban a
// arrancar a tiempo con el default de Prisma: "Unable to start a
// transaction in the given time" — se agotaba la espera por una conexión
// del pool mientras las anteriores tenían el lock de fila, no una
// inconsistencia de datos. Subir estos límites no relaja ninguna garantía,
// sólo le da más margen a una transacción para conseguir turno antes de
// rendirse.
const TRANSACTION_OPTIONS = { maxWait: 10000, timeout: 15000 };

function buildTicketInclude() {
    return {
        qr: true,
        buyer: { select: { firstName: true, lastName: true } },
        ticketType: { select: { name: true } },
        event: { select: { title: true } },
        // Sólo lo usa el preview (fecha/lugar de la función a mostrar antes
        // de confirmar) — buildResult (VALID/ALREADY_USED/CANCELLED) nunca
        // lo lee, así que agregarlo acá no cambia ninguna respuesta existente.
        function: { select: { date: true, venue: true } },
    };
}

function buyerName(ticket) {
    return [ticket.buyer?.firstName, ticket.buyer?.lastName].filter(Boolean).join(" ").trim() || null;
}

// Token crudo del QR: "<ticketId>.<secret>" (base64url, sin puntos, por eso
// alcanza con partir en el primer punto). Extraído para que preview y
// confirmación lo parseen exactamente igual, una sola vez.
function parseScanToken(raw) {
    const token = typeof raw === "string" ? raw : "";
    const separatorIndex = token.indexOf(".");
    return {
        ticketId: separatorIndex > 0 ? token.slice(0, separatorIndex) : null,
        providedSecret: separatorIndex > 0 ? token.slice(separatorIndex + 1) : null,
    };
}

// Contrato uniforme de respuesta: siempre { status, message, data }, siempre
// HTTP 200 (lo decide el controller). `data` nunca incluye nada que no sea
// necesario para la pantalla del scanner — nunca precios, nunca ids
// internos de Sale, nunca secretEncrypted.
function buildResult(result, { ticket, checkIn, scannerName, gate } = {}) {
    let data = null;

    if (result === "VALID") {
        data = {
            ticketNumber: ticket.ticketNumber,
            buyerName: buyerName(ticket),
            ticketType: ticket.ticketType.name,
            eventName: ticket.event.title,
            scannedAt: checkIn.scannedAt,
            scannerName,
            gate: gate ?? null,
        };
    } else if (result === "ALREADY_USED") {
        data = {
            ticketNumber: ticket.ticketNumber,
            firstScannedAt: checkIn?.scannedAt ?? null,
            firstScannedGate: checkIn?.gate ?? null,
        };
    } else if (result === "CANCELLED") {
        data = { ticketNumber: ticket.ticketNumber };
    }

    return { status: result, message: RESULT_MESSAGES[result], data };
}

// ÚNICA definición de "qué pasa con este QR" — evento correcto, función
// correcta, cancelada/reembolsada, ya usada. La llama tanto previewScanService
// (de sólo lectura, con el cliente `prisma` normal) como validateScanService
// (adentro de su transacción, con el cliente `tx`) — mismo código, ninguna
// regla duplicada ni reimplementada dos veces. Nunca escribe nada: sólo lee
// y devuelve qué encontró. `status: "READY"` es el único caso en el que el
// ticket pasó TODAS las reglas y sigue ACTIVE — recién ahí tiene sentido
// intentar el paso siguiente (mostrar confirmación, o escribir el CheckIn).
async function resolveScanOutcome(client, { ticketId, providedSecret, eventId, functionId }) {
    const ticket = await client.ticket.findUnique({ where: { id: ticketId }, include: buildTicketInclude() });
    if (!ticket || ticket.deletedAt) {
        return { status: "NOT_FOUND" };
    }

    let secretMatches;
    try {
        const expectedSecret = decryptSecret(ticket.qr.secretEncrypted);
        const expectedBuffer = Buffer.from(expectedSecret);
        const providedBuffer = Buffer.from(providedSecret);
        secretMatches =
            expectedBuffer.length === providedBuffer.length &&
            crypto.timingSafeEqual(expectedBuffer, providedBuffer);
    } catch {
        secretMatches = false;
    }
    if (!secretMatches) {
        // No se distingue de "no existe": no hay que confirmarle a quien
        // escanea un token adulterado que el ticketId sí era real. Igual se
        // devuelve `ticket` (nunca en la respuesta pública — sólo para que
        // el caller pueda loguear a qué ticket real apuntaba el intento).
        return { status: "NOT_FOUND", ticket };
    }

    if (ticket.eventId !== eventId || (functionId && ticket.functionId !== functionId)) {
        return { status: "WRONG_EVENT", ticket };
    }

    if (ticket.status === "CANCELLED" || ticket.status === "REFUNDED") {
        return { status: "CANCELLED", ticket };
    }

    if (ticket.status === "USED") {
        // CheckIn ya no es 1:1 con Ticket (puede reactivarse y volver a
        // escanearse, ver ticketAdmin.service.js) — findFirst + orderBy
        // trae el ingreso más reciente, que es lo que corresponde mostrar
        // como "cuándo entró" mientras siga USED.
        const checkIn = await client.checkIn.findFirst({ where: { ticketId: ticket.id }, orderBy: { scannedAt: "desc" } });
        return { status: "ALREADY_USED", ticket, checkIn };
    }

    return { status: "READY", ticket };
}

// Paso 1 del nuevo flujo de dos fases: leer el QR y mostrarle al operador
// contra quién está a punto de autorizar el ingreso, SIN registrar nada
// todavía. Nunca escribe ScanAttempt/CheckIn/Ticket, nunca devuelve `stats`
// (nada se consumió). Reutiliza exactamente resolveScanOutcome() y
// buildResult() — ninguna regla de negocio se reimplementa acá aparte del
// armado de la info adicional para READY (nombre del titular, tipo de
// entrada, función, ingresos permitidos/usados/restantes).
//
// Esto NUNCA es la fuente de verdad: es sólo una vista previa de sólo
// lectura. Si el operador aprieta "Confirmar ingreso", validateScanService
// vuelve a correr resolveScanOutcome() desde cero, adentro de una
// transacción con el mismo guard atómico de siempre — así que si esta
// preview quedó desactualizada (otro scanner se adelantó, el evento se
// canceló, lo que sea) nunca puede colarse un ingreso indebido.
export const previewScanService = async (scannerContext, input) => {
    const access = await resolveScannerAccess(scannerContext, input?.eventId);
    const eventId = access.eventId;
    const functionId = input?.functionId || null;

    const { ticketId, providedSecret } = parseScanToken(input?.token);
    if (!ticketId || !providedSecret) {
        return buildResult("NOT_FOUND");
    }

    const outcome = await resolveScanOutcome(prisma, { ticketId, providedSecret, eventId, functionId });

    if (outcome.status === "NOT_FOUND") return buildResult("NOT_FOUND");
    if (outcome.status === "WRONG_EVENT") return buildResult("WRONG_EVENT");
    if (outcome.status === "CANCELLED") return buildResult("CANCELLED", { ticket: outcome.ticket });
    if (outcome.status === "ALREADY_USED") {
        return buildResult("ALREADY_USED", { ticket: outcome.ticket, checkIn: outcome.checkIn });
    }

    // READY: el modelo actual de Ticket es de una sola entrada (no hay
    // pases multi-ingreso) — allowed/used/remaining se calculan así a
    // propósito, no se hardcodean sueltos, para que si el día de mañana
    // TicketType suma un límite de reingresos, sólo haya que tocar este
    // cálculo y no el resto de la pantalla.
    const ticket = outcome.ticket;
    return {
        status: "READY",
        message: "Entrada válida — verificá antes de confirmar.",
        data: {
            ticketNumber: ticket.ticketNumber,
            buyerName: buyerName(ticket),
            ticketType: ticket.ticketType.name,
            eventName: ticket.event.title,
            functionDate: ticket.function.date,
            venue: ticket.function.venue,
            allowedEntries: 1,
            usedEntries: 0,
            remainingEntries: 1,
            ticketStatus: ticket.status,
        },
    };
};

// El corazón del sistema: valida un QR y, si es válido, registra el
// ingreso. Todo dentro de UNA transacción. SIEMPRE registra un ScanAttempt,
// sin importar el resultado (incluso NOT_FOUND/WRONG_EVENT/CANCELLED).
// Nunca lanza un error HTTP por un resultado de negocio — eso es lo que
// devuelve `status`. `scannerContext` es req.scanner (ya autenticado y
// verificado ACTIVE por requireScannerSession). El eventId puede venir del
// cliente (input.eventId, un scanner con varias asignaciones activas elige
// con cuál está operando) — pero NUNCA se confía en él sin más:
// resolveScannerAccess lo valida contra la base (¿existe una fila
// EventScanner ACTIVE con el mismo email para ese evento?) antes de usarlo
// para nada. Si no se manda ninguno, es exactamente el mismo camino de
// siempre (el evento del ancla, sin query extra). `access` — no
// scannerContext — es lo que se usa para atribuir el CheckIn/ScanAttempt:
// tiene que quedar registrado con el EventScanner de ESE evento, nunca con
// el de la sesión con la que se inició sesión si son distintos.
export const validateScanService = async (scannerContext, input) => {
    const access = await resolveScannerAccess(scannerContext, input?.eventId);
    const eventId = access.eventId;
    const functionId = input?.functionId || null;
    const gate = input?.gate || access.gate || null;
    const ip = input?.ip || null;
    const userAgent = input?.userAgent || null;

    const scannerName = [access.firstName, access.lastName].filter(Boolean).join(" ").trim() || access.name;

    const { ticketId, providedSecret } = parseScanToken(input?.token);

    const result = await prisma.$transaction(async (tx) => {
        async function recordAttempt(scanResult, resolvedTicketId) {
            await tx.scanAttempt.create({
                data: { ticketId: resolvedTicketId ?? null, eventId, result: scanResult, scannedBy: access.id, gate, ip, userAgent },
            });
        }

        // Ampliación del contrato (no rompe nada existente: `status`/`message`/
        // `data` quedan intactos, esto agrega una clave más al objeto de nivel
        // superior). El scanner necesita actualizar su contador "ingresados/
        // restantes" después de CADA scan sin hacer una segunda request — así
        // que `stats` se calcula siempre en base a `functionId` (la función
        // activa de la sesión del scanner), no a `ticket.functionId`. Se hace
        // a propósito incluso en NOT_FOUND/WRONG_EVENT/CANCELLED: la pantalla
        // del scanner debe seguir mostrando el contador correcto de SU función
        // activa aunque el QR escaneado no haya sido válido para ella. Si no
        // se mandó `functionId` (llamador no lo tiene todavía), `stats` es
        // `null` — no se inventa un valor.
        async function withStats(coreResult) {
            const stats = functionId ? await getFunctionCounters(tx, functionId) : null;
            return { ...coreResult, stats };
        }

        if (!ticketId || !providedSecret) {
            await recordAttempt("NOT_FOUND", null);
            return withStats(buildResult("NOT_FOUND"));
        }

        // Única fuente de verdad de las reglas de negocio (evento, función,
        // cancelada, ya usada) — la misma que usa previewScanService, pero
        // corrida DE NUEVO acá, adentro de esta transacción con `tx`. Nunca
        // se confía en un resultado de preview resuelto segundos antes: si
        // otro scanner ya la usó mientras esta pantalla de confirmación
        // estaba abierta, esta consulta lo va a ver.
        const outcome = await resolveScanOutcome(tx, { ticketId, providedSecret, eventId, functionId });

        if (outcome.status === "NOT_FOUND") {
            await recordAttempt("NOT_FOUND", outcome.ticket?.id ?? null);
            return withStats(buildResult("NOT_FOUND"));
        }
        if (outcome.status === "WRONG_EVENT") {
            await recordAttempt("WRONG_EVENT", outcome.ticket.id);
            return withStats(buildResult("WRONG_EVENT"));
        }
        if (outcome.status === "CANCELLED") {
            await recordAttempt("CANCELLED", outcome.ticket.id);
            return withStats(buildResult("CANCELLED", { ticket: outcome.ticket }));
        }
        if (outcome.status === "ALREADY_USED") {
            await recordAttempt("ALREADY_USED", outcome.ticket.id);
            return withStats(buildResult("ALREADY_USED", { ticket: outcome.ticket, checkIn: outcome.checkIn }));
        }

        const ticket = outcome.ticket;

        // Update condicional atómico ACTIVE -> USED: si dos escaneos del mismo
        // QR llegan al mismo tiempo (o si esta confirmación llega tarde
        // porque el operador tardó en mirar la pantalla de verificación y
        // otro scanner ya la registró), sólo uno encuentra status: ACTIVE
        // todavía. Es el guard real, siempre fue éste — resolveScanOutcome
        // de arriba dijo "READY" hace un instante, pero nunca es la
        // autorización en sí, sólo este UPDATE lo es.
        const updated = await tx.ticket.updateMany({ where: { id: ticket.id, status: "ACTIVE" }, data: { status: "USED" } });
        if (updated.count === 0) {
            // Perdió la carrera contra otro scan simultáneo (o contra una
            // confirmación que llegó primero).
            const checkIn = await tx.checkIn.findFirst({ where: { ticketId: ticket.id }, orderBy: { scannedAt: "desc" } });
            await recordAttempt("ALREADY_USED", ticket.id);
            return withStats(buildResult("ALREADY_USED", { ticket, checkIn }));
        }

        // Ya no hay un @unique de CheckIn.ticketId de respaldo (a propósito:
        // el historial de ingresos se conserva completo) — el guard real
        // contra doble-registro sigue siendo el updateMany atómico de
        // arriba, que ya garantiza que sólo un escaneo gana la carrera.
        const checkIn = await tx.checkIn.create({
            data: { ticketId: ticket.id, source: "SCAN", scannerId: access.id, gate, device: userAgent },
        });
        await tx.ticketQr.update({ where: { ticketId: ticket.id }, data: { usedAt: new Date() } });
        await recordAttempt("VALID", ticket.id);

        return withStats(buildResult("VALID", { ticket, checkIn, scannerName, gate }));
    }, TRANSACTION_OPTIONS);

    logger.info("Scan validated", { eventId, functionId, scannerId: access.id, result: result.status });
    return result;
};
