import prisma from "../config/prisma.js";

// Fase 3K, sección 9 — antes de pedirle al organizador que cargue una
// ubicación desde cero, se revisa si esta Organization ya tiene una
// dirección usable en algún evento anterior (publicado o no) y se ofrece
// reutilizarla. Sólo lectura, nunca modifica nada — si no hay ningún
// evento con dirección usable, devuelve `null` y el sub-flujo de WhatsApp
// sigue exactamente igual que hoy (compartir ubicación / dirección manual
// en un mensaje).
//
// `address` es el único campo realmente indispensable (mismo criterio que
// isPublishableWhatsappLocation en whatsappOrganizerBot.service.js): sin
// texto de dirección no hay nada útil que ofrecer reusar, aunque el evento
// tenga coordenadas sueltas.
export async function findReusableOrganizationLocation(organizationId) {
    if (!organizationId) return null;

    const event = await prisma.event.findFirst({
        where: {
            organizationId,
            OR: [{ formattedAddress: { not: null } }, { addressLine: { not: null } }],
        },
        orderBy: { createdAt: "desc" },
        select: {
            venueName: true,
            formattedAddress: true,
            addressLine: true,
            city: true,
            province: true,
            latitude: true,
            longitude: true,
            googlePlaceId: true,
        },
    });
    if (!event) return null;

    const address = event.formattedAddress || event.addressLine;
    if (!address) return null;

    return {
        venueName: event.venueName ?? null,
        address,
        city: event.city ?? null,
        province: event.province ?? null,
        latitude: event.latitude ?? null,
        longitude: event.longitude ?? null,
        googlePlaceId: event.googlePlaceId ?? null,
    };
}
