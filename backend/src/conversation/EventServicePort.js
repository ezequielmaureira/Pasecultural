import {
    createEventService,
    syncEventLinksService,
    syncEventScheduleService,
    updateMyEventService,
    getMyEventByIdService,
} from "../services/event.service.js";
import { SOCIAL_NETWORKS } from "../utils/eventCategories.js";
import { combineCalendarDateTime } from "../utils/calendarDate.js";
import { translateEventServiceError } from "./errorMessages.js";

const SOCIAL_NETWORK_LABEL = Object.fromEntries(SOCIAL_NETWORKS.map((s) => [s.id, s.label]));

// Un evento "gratuito" (el organizador respondió "No" en el paso de entradas)
// igual necesita al menos un TicketType en EventService para poder
// publicarse (ver assertPublishable en event.service.js) — se genera una
// entrada general a precio 0 en vez de duplicar esa regla acá.
const FREE_TICKET_DEFAULT_QUANTITY = 999999;

function buildLocationInput(location) {
    if (!location) return undefined;
    // El organizador sólo carga dirección/ciudad/provincia en el flujo
    // conversacional (sin picker de Google Maps todavía en este canal), así
    // que venueName usa la dirección como fallback. Publicar seguirá
    // exigiendo coordenadas (assertPublishable ya lo valida) hasta que el
    // canal Web integre el mapa en una fase siguiente.
    return {
        venueName: location.venueName || location.address,
        formattedAddress: location.address,
        addressLine: location.address,
        city: location.city,
        province: location.province,
        latitude: location.latitude ?? null,
        longitude: location.longitude ?? null,
        googlePlaceId: location.googlePlaceId ?? null,
    };
}

function buildTicketTypesInput(draft) {
    if (draft.hasTickets && draft.ticketTypes?.length) {
        return draft.ticketTypes.map((tt) => ({
            name: tt.name,
            price: tt.price,
            quantity: tt.quantity,
        }));
    }
    return [{ name: "Entrada general", price: 0, quantity: FREE_TICKET_DEFAULT_QUANTITY }];
}

// `fn.date` es una fecha de calendario ("YYYY-MM-DD"), nunca un instante —
// combineCalendarDateTime la combina con la hora aplicando el offset fijo
// de la plataforma (América/Argentina, -03:00) explícitamente en el string,
// así el resultado no depende de la timezone del proceso de Node. Antes esto
// usaba `new Date(...)` sin offset, que se interpreta con la timezone LOCAL
// DEL SERVIDOR — en un host configurado en UTC (lo más común), una función
// cargada a las 21:00 se guardaba 3 horas más tarde de lo real.
function buildFunctionsInput(draft) {
    const venue = draft.location?.venueName || draft.location?.address || "";
    return (draft.functions ?? []).map((fn) => ({
        date: combineCalendarDateTime(fn.date, fn.startTime),
        endAt: combineCalendarDateTime(fn.date, fn.endTime),
        venue,
        address: draft.location?.address ?? null,
    }));
}

function buildLinksInput(draft) {
    const links = [];
    if (draft.promoVideoUrl) {
        links.push({ url: draft.promoVideoUrl, title: "Video promocional" });
    }
    for (const social of draft.socialLinks ?? []) {
        links.push({ url: social.url, title: SOCIAL_NETWORK_LABEL[social.network] ?? social.network });
    }
    return links;
}

// Traduce el draftEvent acumulado por el EventCreationEngine a las mismas
// llamadas que hoy hace OrganizerEventWizard.jsx contra EventService, en el
// mismo orden: create -> links -> schedule -> (opcional) publish. No se
// persiste nada hasta que el organizador confirma "Publicar" o "Guardar
// borrador" en el paso PREVIEW.
//
// organizationId (Fase 2G): la Organization ya resuelta al arrancar la
// conversación (ver EventCreationEngine.start/ConversationState.organizationId)
// viaja EXACTA a las 5 llamadas de abajo — nunca se vuelve a inferir acá.
// `null` reproduce el comportamiento legacy (Web, findFirst por clerkId);
// un valor no-null exige pertenencia real dentro de cada service, ver
// getMyOrganization en event.service.js.
export async function commit(clerkId, draftEvent, action, organizationId = null) {
    try {
        let event = await createEventService(
            clerkId,
            {
                title: draftEvent.title,
                description: draftEvent.description,
                category: draftEvent.category,
                customCategory: draftEvent.customCategory,
                coverImage: draftEvent.coverImage,
                location: buildLocationInput(draftEvent.location),
            },
            organizationId
        );

        const links = buildLinksInput(draftEvent);
        if (links.length > 0) {
            await syncEventLinksService(clerkId, event.id, links, organizationId);
        }

        await syncEventScheduleService(
            clerkId,
            event.id,
            {
                functions: buildFunctionsInput(draftEvent),
                ticketTypes: buildTicketTypesInput(draftEvent),
            },
            organizationId
        );

        if (action === "PUBLISH") {
            event = await updateMyEventService(clerkId, event.id, { status: "PUBLISHED" }, organizationId);
        } else {
            event = await getMyEventByIdService(clerkId, event.id, organizationId);
        }

        return event;
    } catch (error) {
        const message = translateEventServiceError(error);
        if (message) {
            const translated = new Error(message);
            translated.code = error.message;
            translated.isConversational = true;
            throw translated;
        }
        throw error;
    }
}
