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

// Pura, exportada para poder probarla directamente sin tocar Prisma: unión
// de las dos fuentes de candidatos (vínculos ya existentes + Organizations
// recién descubiertas por teléfono), deduplicada EXCLUSIVAMENTE por
// organizationId — nunca por nombre, teléfono, responsable o DNI, ninguno
// de los cuales identifica a una Organization de forma inequívoca. Preserva
// el orden de aparición (primero `byLink`, después `byPhone`).
export function mergeOrganizationCandidates(byLink, byPhone) {
    const seen = new Set();
    const combined = [];
    for (const candidate of [...byLink, ...byPhone]) {
        if (seen.has(candidate.organizationId)) continue;
        seen.add(candidate.organizationId);
        combined.push(candidate);
    }
    return combined;
}

// FIX (post FASE 3K) — bug real detectado en prueba: dos Organizations
// APPROVED con el mismo teléfono ("Cine Nadia" y "La Taberna de Mou"), pero
// sólo una ya tenía un WhatsappOrganizerLink creado (de un contacto
// anterior, o de cuando la otra Organization todavía no estaba APPROVED).
// La versión vieja de esta función hacía un `return` apenas encontraba
// CUALQUIER link existente para el wa_id, sin volver a mirar
// Organization.phone — así que la segunda Organization (sin link todavía)
// jamás se descubría, para siempre, aunque su teléfono coincidiera
// perfectamente. La causa NO era la unicidad de ningún campo del schema
// (waId nunca fue @unique en WhatsappOrganizerLink, ver el modelo) sino
// exclusivamente ese atajo de "ya encontré uno, no sigo buscando".
//
// Corrección: SIEMPRE se consultan ambas fuentes — vínculos ya existentes
// para este wa_id, Y Organizations APPROVED sin vínculo cuyo teléfono
// coincide — nunca una en lugar de la otra. Se unen, se deduplican
// exclusivamente por organizationId (nunca por nombre/teléfono/responsable/
// DNI — dos Organizations legítimamente distintas pueden compartir
// cualquiera de esos datos) y se devuelve el conjunto completo. Los
// vínculos que falten para las Organizations recién descubiertas por
// teléfono se crean acá mismo, de forma idempotente (P2002 atrapado, igual
// que antes) — nunca se duplica un link ya existente.
export async function discoverWhatsappOrganizationCandidates(waId) {
    // waId sin forma de teléfono reconocible: nunca puede coincidir con
    // ningún Organization.phone real (isSameArgentinePhone exige que ambos
    // lados normalicen), así que se evita la consulta de descubrimiento por
    // completo — los vínculos ya existentes (`byLink`) igual se devuelven
    // tal cual. Se calcula ANTES de disparar ninguna query para poder
    // decidir de una sola vez si hace falta una o dos.
    const normalizedWaId = normalizeArgentinePhoneForMatching(waId);

    if (!normalizedWaId) {
        const existingLinks = await prisma.whatsappOrganizerLink.findMany({
            where: { waId },
            select: CANDIDATE_LINK_SELECT,
        });
        return existingLinks.filter((link) => link.organization.status === "APPROVED").map(toCandidate);
    }

    // Fase 4 (optimización de latencia) — las dos búsquedas son
    // independientes entre sí: la segunda filtra por condiciones fijas
    // (status/phone/whatsappOrganizerLink), nunca por lo que haya devuelto
    // la primera, así que no hay ninguna dependencia real que obligue a
    // esperarlas en secuencia. Antes corrían una detrás de la otra (dos
    // round-trips en serie); con Promise.all corren en paralelo (un solo
    // round-trip de latencia de red). Sigue corriendo SIEMPRE, nunca
    // condicionada a si `existingLinks` ya tenía resultados — es
    // exactamente lo que permite descubrir una segunda Organization que se
    // aprobó o cargó su teléfono después de que la primera ya se vinculó.
    const [existingLinks, unlinkedApproved] = await Promise.all([
        prisma.whatsappOrganizerLink.findMany({ where: { waId }, select: CANDIDATE_LINK_SELECT }),
        // Sólo Organizations APPROVED, con teléfono cargado, y que TODAVÍA
        // no tengan ningún WhatsApp asociado — una Organization ya
        // vinculada (a este u otro wa_id) nunca vuelve a ser candidata de
        // descubrimiento: así se garantiza que nunca se reasigna/pisa un
        // vínculo existente (ver sección "concurrencia" del informe de
        // entrega).
        prisma.organization.findMany({
            where: { status: "APPROVED", phone: { not: null }, whatsappOrganizerLink: null },
            select: { id: true, name: true, phone: true, owner: { select: { clerkId: true, firstName: true } } },
        }),
    ]);
    const byLink = existingLinks.filter((link) => link.organization.status === "APPROVED").map(toCandidate);
    const matches = unlinkedApproved.filter((org) => isSameArgentinePhone(org.phone, waId));

    const byPhone = [];
    for (const org of matches) {
        try {
            // create puro, nunca upsert: si otra request concurrente ya creó
            // el vínculo para esta misma Organization (organizationId
            // @unique), P2002 se atrapa y esa Organization simplemente no
            // se agrega de nuevo — nunca se pisa el waId que ya haya quedado
            // asociado.
            await prisma.whatsappOrganizerLink.create({ data: { waId, organizationId: org.id } });
            byPhone.push({ organizationId: org.id, name: org.name, clerkId: org.owner.clerkId, ownerFirstName: org.owner.firstName });
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

    return mergeOrganizationCandidates(byLink, byPhone);
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
