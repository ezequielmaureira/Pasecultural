import prisma from "../config/prisma.js";
import { isSameArgentinePhone, normalizeArgentinePhoneForMatching } from "../utils/normalizeArgentinePhone.js";
import { logger } from "../logging/logger.js";

// Fase 2G — reemplaza whatsappOrganizerIdentity.service.js (Fase 2F) en el
// flujo normal de WhatsApp Organizer: la identificación deja de depender de
// un código de 6 dígitos y pasa a resolverse por coincidencia exacta de
// teléfono contra Organization.phone. whatsappOrganizerIdentity.service.js
// queda sin usar (legacy), no se borra (ver informe de entrega).

// Fase 3K — se agrega `ownerFirstName` (User.firstName, el mismo dato que ya
// sincroniza Clerk) para poder saludar a la PERSONA, no a la organización
// (ver sección "Identificación del usuario" del pedido). Nunca se inventa
// ni se deriva de ningún otro campo — si Clerk no sincronizó un nombre,
// queda `null` y el saludo cae a la variante sin nombre (ver
// resolvePersonFirstName en whatsappOrganizerBot.service.js).
function toCandidate(link) {
    return {
        organizationId: link.organizationId,
        name: link.organization.name,
        clerkId: link.organization.owner.clerkId,
        ownerFirstName: link.organization.owner.firstName,
    };
}

const CANDIDATE_LINK_SELECT = {
    organizationId: true,
    organization: { select: { name: true, status: true, owner: { select: { clerkId: true, firstName: true } } } },
};

// PRIMERO resuelve vínculos ya existentes para este wa_id (rápido, sin
// tocar Organization.phone de nuevo) — sólo si no hay ninguno vigente se
// dispara el descubrimiento por teléfono. Revalida `status==="APPROVED"`
// en ambos caminos: una Organization pudo pasar a SUSPENDED/REJECTED
// después de haberse vinculado, y un vínculo viejo nunca debe alcanzar por
// sí solo para operar.
export async function discoverWhatsappOrganizationCandidates(waId) {
    const existingLinks = await prisma.whatsappOrganizerLink.findMany({
        where: { waId },
        select: CANDIDATE_LINK_SELECT,
    });
    const approvedExisting = existingLinks.filter((link) => link.organization.status === "APPROVED");
    if (approvedExisting.length > 0) {
        return approvedExisting.map(toCandidate);
    }

    const normalizedWaId = normalizeArgentinePhoneForMatching(waId);
    if (!normalizedWaId) return [];

    // Sólo Organizations APPROVED, con teléfono cargado, y que TODAVÍA no
    // tengan ningún WhatsApp asociado — una Organization ya vinculada
    // (a este u otro wa_id) nunca vuelve a ser candidata de descubrimiento:
    // así se garantiza que nunca se reasigna/pisa un vínculo existente (ver
    // sección "concurrencia" del informe de entrega).
    const unlinkedApproved = await prisma.organization.findMany({
        where: { status: "APPROVED", phone: { not: null }, whatsappOrganizerLink: null },
        select: { id: true, name: true, phone: true, owner: { select: { clerkId: true, firstName: true } } },
    });
    const matches = unlinkedApproved.filter((org) => isSameArgentinePhone(org.phone, waId));
    if (matches.length === 0) return [];

    const created = [];
    for (const org of matches) {
        try {
            // create puro, nunca upsert: si otra request concurrente ya creó
            // el vínculo para esta misma Organization (organizationId
            // @unique), P2002 se atrapa y esa Organization simplemente no
            // se agrega de nuevo — nunca se pisa el waId que ya haya quedado
            // asociado.
            await prisma.whatsappOrganizerLink.create({ data: { waId, organizationId: org.id } });
            created.push({ organizationId: org.id, name: org.name, clerkId: org.owner.clerkId, ownerFirstName: org.owner.firstName });
        } catch (error) {
            if (error.code === "P2002") {
                logger.warn("whatsapp organizer discovery: conflicto de vínculo concurrente", {
                    reason: "ORGANIZATION_ALREADY_LINKED_CONCURRENTLY",
                });
                continue;
            }
            throw error;
        }
    }

    return created;
}

// ==================================================================
// Estado explícito "esperando selección" — nunca se infiere de
// createdAt/updatedAt (ver comentario del modelo en schema.prisma).
// ==================================================================

export async function getPendingOrganizationSelection(waId) {
    return prisma.whatsappPendingOrganizationSelection.findUnique({ where: { waId } });
}

// Reemplaza cualquier selección pendiente anterior para este wa_id (si el
// organizador vuelve a escribir "hola" después de haber abandonado una
// selección vieja, arranca de cero con la lista actual) — upsert seguro
// acá porque la clave es waId, no organizationId: nunca reasigna una
// Organization, sólo reemplaza "cuál es la elección en curso de este
// número", que es exactamente lo que representa esta tabla.
export async function createPendingOrganizationSelection(waId, candidateOrganizationIds) {
    return prisma.whatsappPendingOrganizationSelection.upsert({
        where: { waId },
        create: { waId, status: "AWAITING_SELECTION", candidateOrganizationIds, selectedOrganizationId: null },
        update: { status: "AWAITING_SELECTION", candidateOrganizationIds, selectedOrganizationId: null },
    });
}

// Pura — decide si `rawText` es una elección válida contra la lista EXACTA
// que se le mostró al usuario (nunca se vuelve a calcular desde
// Organization.phone). Sólo un índice 1..N es válido; cualquier otra cosa
// (organizationId pegado a mano, texto libre, un número fuera de rango)
// se rechaza.
export function resolveOrganizationSelectionChoice(candidateOrganizationIds, rawText) {
    const trimmed = typeof rawText === "string" ? rawText.trim() : "";
    if (!/^\d+$/.test(trimmed)) return { valid: false };

    const index = Number(trimmed);
    if (!Number.isInteger(index) || index < 1 || index > candidateOrganizationIds.length) {
        return { valid: false };
    }

    return { valid: true, organizationId: candidateOrganizationIds[index - 1] };
}

export async function confirmOrganizationSelection(waId, organizationId) {
    return prisma.whatsappPendingOrganizationSelection.update({
        where: { waId },
        data: { status: "AWAITING_CONFIRMATION", selectedOrganizationId: organizationId },
    });
}

// Idempotente: si ya no existe (otro mensaje concurrente la borró primero),
// no es un error — el estado final deseado ("no hay selección pendiente")
// ya se cumple.
export async function clearPendingOrganizationSelection(waId) {
    await prisma.whatsappPendingOrganizationSelection.deleteMany({ where: { waId } });
}

// Único lookup que necesita el paso AWAITING_CONFIRMATION -> "Sí" (el
// candidato ya resuelto sólo guardó organizationId, no name/clerkId).
// Revalida APPROVED por el mismo motivo que discoverWhatsappOrganizationCandidates.
export async function resolveOrganizationOwner(organizationId) {
    const organization = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { name: true, status: true, owner: { select: { clerkId: true, firstName: true } } },
    });
    if (!organization || organization.status !== "APPROVED") return null;
    return { name: organization.name, clerkId: organization.owner.clerkId, ownerFirstName: organization.owner.firstName };
}
