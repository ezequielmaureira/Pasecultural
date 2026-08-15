import prisma from "../config/prisma.js";

// Fase CIERRE — idempotencia de mensajes entrantes de WhatsApp por wamid.
// Ver el comentario del modelo (schema.prisma#WhatsappInboundMessageClaim)
// para el ciclo de estados completo. Este archivo es el ÚNICO punto que
// lee/escribe esa tabla — nunca se toca prisma.whatsappInboundMessageClaim
// desde ningún otro lado (mismo criterio que el resto de los services
// "puros" de infraestructura de WhatsApp, ej. whatsappPendingStepInput.service.js).

// Ventana de lease de un reclamo PROCESSING: cuánto tiempo se le da a una
// entrega en curso antes de considerarla "colgada" (proceso caído a mitad
// de camino, nunca llegó a marcar COMPLETED ni FAILED) y permitir que una
// reentrega posterior la retome. El peor caso real medido en producción
// (PREVIEW_PUBLISH, ver informe de latencia / utils/whatsappPerf.js) ronda
// los 20-25s — 2 minutos deja un margen amplio para no robarle el reclamo a
// una entrega que sigue legítimamente en curso, sin dejar un mensaje real
// bloqueado por una eternidad si el proceso efectivamente murió.
export const CLAIM_LEASE_MS = 120000;

function computeLeaseExpiresAt(now) {
    return new Date(now.getTime() + CLAIM_LEASE_MS);
}

// Reclama atómicamente `wamid` para esta entrega.
//
// Camino feliz (wamid nunca visto): UNA sola escritura — `create`, apoyada
// en la restricción @unique sobre wamid — nunca una lectura previa. Es
// exactamente lo que pide la sección RENDIMIENTO del pedido: la enorme
// mayoría de los mensajes reales tienen un wamid nuevo, así que el costo
// agregado de la deduplicación para ese caso es un único round-trip.
//
// Sólo cuando esa escritura choca (P2002: ya existe una fila para este
// wamid — una reentrega de Meta, o una entrega concurrente del mismo
// mensaje) se paga UNA lectura extra para decidir qué representa ese
// choque:
//   - COMPLETED                                -> duplicado real, ignorar.
//   - PROCESSING con lease todavía vigente      -> entrega hermana en curso
//                                                  AHORA MISMO, ignorar (no
//                                                  se le puede robar).
//   - FAILED, o PROCESSING con lease vencido    -> reclamable: una segunda
//                                                  escritura CONDICIONAL
//                                                  (updateMany filtrando
//                                                  exactamente por el estado
//                                                  que se acaba de leer)
//                                                  hace el "robo" sin pisar
//                                                  a otra entrega que haya
//                                                  ganado la carrera en el
//                                                  medio — si alguien más ya
//                                                  se adelantó, ese update
//                                                  afecta 0 filas y esta
//                                                  entrega se rinde, nunca
//                                                  procesa dos veces.
//
// Devuelve siempre {claimed: boolean, reason?: string} — nunca lanza salvo
// un error real de Prisma no relacionado con el conflicto de unicidad
// esperado (P2002), que el caller (processInboundMessage) decide cómo
// degradar.
export async function claimInboundMessage(wamid) {
    const now = new Date();

    const claimedNow = await tryCreateClaim(wamid, now);
    if (claimedNow) return { claimed: true };

    const existing = await prisma.whatsappInboundMessageClaim.findUnique({ where: { wamid } });
    if (!existing) {
        // No debería pasar nunca (esta tabla nunca borra filas, y el create
        // de arriba acaba de chocar contra una que "existe") — tratado como
        // reclamable desde cero, sin recursión: un segundo intento de
        // `create` nunca puede volver a chocar dos veces seguidas por la
        // misma causa real (la fila que causó el primer choque ya no está).
        const claimedRetry = await tryCreateClaim(wamid, now);
        return claimedRetry ? { claimed: true } : { claimed: false, reason: "RACE" };
    }

    if (existing.status === "COMPLETED") {
        return { claimed: false, reason: "COMPLETED" };
    }

    if (existing.status === "PROCESSING" && existing.leaseExpiresAt > now) {
        return { claimed: false, reason: "IN_PROGRESS" };
    }

    // FAILED (reintentable de inmediato) o PROCESSING con lease vencido
    // (entrega anterior colgada/caída) — ambos casos legítimos para
    // reclamar de nuevo. El WHERE reproduce el mismo estado que se acaba de
    // observar: si otra entrega concurrente ya lo cambió en el medio (ganó
    // la carrera del reclamo), este update afecta 0 filas.
    const { count } = await prisma.whatsappInboundMessageClaim.updateMany({
        where: {
            wamid,
            OR: [{ status: "FAILED" }, { status: "PROCESSING", leaseExpiresAt: { lte: now } }],
        },
        data: { status: "PROCESSING", leaseExpiresAt: computeLeaseExpiresAt(now), attempts: { increment: 1 } },
    });

    return count > 0 ? { claimed: true } : { claimed: false, reason: "RACE" };
}

async function tryCreateClaim(wamid, now) {
    try {
        await prisma.whatsappInboundMessageClaim.create({
            data: { wamid, status: "PROCESSING", attempts: 1, leaseExpiresAt: computeLeaseExpiresAt(now) },
        });
        return true;
    } catch (error) {
        if (error.code === "P2002") return false;
        throw error;
    }
}

// Marca el reclamo como terminado con éxito — a partir de acá, cualquier
// reentrega futura de este mismo wamid (aunque venza leaseExpiresAt) se
// ignora para siempre (ver claimInboundMessage). Sólo debe llamarse cuando
// el caller efectivamente tiene el reclamo (claimed:true), nunca "por las
// dudas" — si la fila no existe (no debería pasar) Prisma lanza P2025 y el
// caller decide cómo tratarlo (ver processInboundMessage: nunca deja
// escapar la excepción fuera del propio mensaje).
export async function completeInboundMessageClaim(wamid) {
    await prisma.whatsappInboundMessageClaim.update({
        where: { wamid },
        data: { status: "COMPLETED" },
    });
}

// Libera el reclamo como reintentable DE INMEDIATO (sin esperar a que
// venza leaseExpiresAt) — se llama cuando la entrega tiró una excepción
// real. Mismo criterio que completeInboundMessageClaim sobre cuándo
// llamarla.
export async function failInboundMessageClaim(wamid) {
    await prisma.whatsappInboundMessageClaim.update({
        where: { wamid },
        data: { status: "FAILED" },
    });
}
