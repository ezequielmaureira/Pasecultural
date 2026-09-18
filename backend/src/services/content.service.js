import prisma from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";

// Developer > Contenido (V1 mínima) — un único placement hoy:
// ORGANIZER_FEST_PASS_INTRO. Genérico por diseño (placement como parámetro)
// para poder agregar otros placements después sin duplicar este service.

function isValidHttpUrl(value) {
    if (typeof value !== "string" || value.trim() === "") return false;
    try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
    } catch {
        return false;
    }
}

function serialize(card) {
    if (!card) return null;
    return {
        placement: card.placement,
        imageUrl: card.imageUrl,
        active: card.active,
    };
}

// Lectura para Developer — devuelve null (no una card "vacía" default) si
// nunca se configuró nada, para que el frontend pueda distinguir
// "todavía no configurado" de "configurado e inactivo".
export async function getContentCardService(placement) {
    const card = await prisma.contentCard.findUnique({ where: { placement } });
    return serialize(card);
}

// PUT — upsert: como mucho una fila por placement (@@unique en el schema).
// Si active=true, imageUrl tiene que ser una URL http/https válida.
export async function updateContentCardService(placement, { imageUrl, active }) {
    if (typeof active !== "boolean") {
        throw new AppError(ErrorCodes.CONTENT_CARD_INVALID);
    }
    const normalizedImageUrl = typeof imageUrl === "string" && imageUrl.trim() !== "" ? imageUrl.trim() : null;
    if (active && !isValidHttpUrl(normalizedImageUrl)) {
        throw new AppError(ErrorCodes.CONTENT_CARD_INVALID);
    }

    const card = await prisma.contentCard.upsert({
        where: { placement },
        create: { placement, imageUrl: normalizedImageUrl, active },
        update: { imageUrl: normalizedImageUrl, active },
    });
    return serialize(card);
}

// Consumo público (Organizer, sin rol Developer) — nunca expone nada más
// que { active, imageUrl }, y siempre { active: false, imageUrl: null }
// cuando no está activa o no existe fila, para que el caller (FestPass
// intro) tenga un único fallback a manejar. Ver content.public.routes.js.
export async function getPublicContentCardService(placement) {
    const card = await prisma.contentCard.findUnique({ where: { placement } });
    if (!card || !card.active || !isValidHttpUrl(card.imageUrl)) {
        return { active: false, imageUrl: null };
    }
    return { active: true, imageUrl: card.imageUrl };
}
