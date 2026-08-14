import prisma from "../config/prisma.js";

// Fase 3B — infraestructura pura de estado temporal para el adaptador de
// WhatsApp: NADA de lógica de negocio de fechas/horarios/ubicación/entradas
// vive acá, sólo el CRUD de "hay un input compuesto en construcción para
// esta conversación, en este step, en este sub-paso". whatsapp.controller.js
// TODAVÍA no llama a nada de este archivo (ver informe de entrega) — existe
// para que las fases siguientes lo consuman sin necesitar otra migración.
//
// conversationId es SIEMPRE la clave real (WhatsappPendingStepInput.conversationId
// es @unique en el schema): a lo sumo un pending por conversación, nunca por
// waId — una conversación ya sabe a qué wa_id/Organization pertenece, no
// hace falta duplicar esa referencia acá.

// Lectura simple, sin ninguna validación de step — usarla sólo cuando el
// caller todavía no sabe/no le importa para qué step es el pending (ej.
// para decidir si hay que resetear). Para el camino normal de "¿hay un
// pending VÁLIDO para el step en el que estoy parado?" usar
// getValidPendingStepInput más abajo.
export async function getPendingStepInput(conversationId) {
    return prisma.whatsappPendingStepInput.findUnique({ where: { conversationId } });
}

// Sección "seguridad contra estado viejo" del pedido: el stepId real de la
// conversación es la ÚNICA fuente de verdad de si un pending sigue siendo
// válido — nunca se infiere por antigüedad (createdAt/updatedAt). Si existe
// un pending pero quedó de un stepId distinto (ej. el organizador canceló a
// mitad de camino y luego canceló-y-reinició, o hizo Volver/GOTO), esta
// función NUNCA lo devuelve como válido: devuelve `null` para que el
// caller decida explícitamente resetear (resetPendingStepInput) en vez de
// reutilizarlo en silencio.
export async function getValidPendingStepInput(conversationId, stepId) {
    const pending = await getPendingStepInput(conversationId);
    if (!pending || pending.stepId !== stepId) return null;
    return pending;
}

// Crea un pending NUEVO. A propósito NO es un upsert: conversationId es
// @unique, así que si ya existe uno (de este mismo step o de otro viejo sin
// limpiar), Prisma lo rechaza con P2002 en vez de pisarlo en silencio — el
// caller que sabe que puede haber uno viejo debe usar resetPendingStepInput,
// no este. `partialData` default `{}` (nada respondido todavía).
export async function createPendingStepInput(conversationId, stepId, status, partialData = {}) {
    return prisma.whatsappPendingStepInput.create({
        data: { conversationId, stepId, status, partialData },
    });
}

// Actualiza el sub-paso actual y el acumulado de respuestas ya confirmadas
// de un pending YA EXISTENTE. No hace merge de `partialData` con lo
// anterior — recibe el objeto completo que el caller ya decidió que
// corresponde al nuevo estado (armar ese objeto es lógica de negocio del
// futuro adaptador, no de este service). Falla (P2025) si no existe un
// pending para esa conversación — el caller debe haber creado uno antes.
export async function updatePendingStepInputStatus(conversationId, status, partialData) {
    return prisma.whatsappPendingStepInput.update({
        where: { conversationId },
        data: { status, partialData },
    });
}

// Idempotente: si ya no existe (nunca existió, o ya se había limpiado),
// no es un error — el estado final deseado ("no hay pending") ya se
// cumple. Mismo criterio que clearPendingOrganizationSelection
// (whatsappOrganizerDiscovery.service.js).
export async function deletePendingStepInput(conversationId) {
    await prisma.whatsappPendingStepInput.deleteMany({ where: { conversationId } });
}

// La forma "limpia" de descartar/resetear que pide la sección 5 del pedido:
// reemplaza cualquier pending previo de esta conversación (sea del mismo
// step o de uno viejo) por uno nuevo para `stepId` desde cero. Fase 4
// (optimización de latencia) — antes esto era deleteMany + create (dos
// round-trips); conversationId es @unique en el schema (ver
// WhatsappPendingStepInput.conversationId), así que "borrar lo que había y
// crear lo nuevo" y "upsert-eando esa misma fila" son exactamente el mismo
// resultado final, en una sola escritura. Sigue siendo una única función
// desde el punto de vista del contrato del service (nunca dos llamadas
// sueltas libradas al caller), ahora también una única operación real.
export async function resetPendingStepInput(conversationId, stepId, status, partialData = {}) {
    return prisma.whatsappPendingStepInput.upsert({
        where: { conversationId },
        create: { conversationId, stepId, status, partialData },
        update: { stepId, status, partialData },
    });
}
