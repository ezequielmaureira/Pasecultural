import prisma from "../config/prisma.js";

// Fase 2F — resuelve un wa_id contra el vínculo YA VERIFICADO
// (WhatsappOrganizerLink, ver whatsappOrganizerLink.service.js). Hasta
// esta fase, esta función devolvía siempre null porque no existía ninguna
// forma segura de vincular un número de WhatsApp a un organizer real —
// Organization.phone es un campo de texto libre, opcional, sin @unique y
// sin verificación (ver el informe de entrega de Fase 2E). Esa
// limitación sigue vigente a propósito: esta función NUNCA consulta
// Organization.phone, sólo el vínculo verificado por código.
//
// Devuelve { clerkId, organizationId } — el shape mínimo que
// EventCreationEngine.start necesita (sólo lee clerkId) — o null si el
// wa_id no tiene ningún vínculo verificado todavía.
export async function resolveWhatsappOrganizerIdentity(waId) {
    if (!waId) return null;

    const link = await prisma.whatsappOrganizerLink.findUnique({
        where: { waId },
        select: {
            organizationId: true,
            organization: { select: { owner: { select: { clerkId: true } } } },
        },
    });

    const clerkId = link?.organization?.owner?.clerkId;
    if (!clerkId) return null;

    return { clerkId, organizationId: link.organizationId };
}
