import {
    createEventService,
    syncEventLinksService,
    syncEventScheduleService,
    updateMyEventService,
    getEventWithDetailsById,
    getMyOrganization,
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

// Fase 3J — exportada ÚNICAMENTE para poder testear la cadena real
// Web/WhatsApp → EventServicePort → event.service.js#buildLocationData
// (ver tests/eventLocation.persistence.test.js) sin pasar por Prisma real:
// es una función pura (sin I/O), así que exportarla no agrega ningún riesgo
// ni cambia su comportamiento — sigue siendo exclusivamente interna a este
// módulo desde el punto de vista de `commit`, el único caller real.
export function buildLocationInput(location) {
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
//
// Fase 8.1 (perf) — `context` se resuelve UNA sola vez acá y se reenvía a
// las 4 llamadas de abajo que lo aceptan (createEventService/
// syncEventLinksService/syncEventScheduleService/updateMyEventService).
// Antes, cada una de esas 4 volvía a llamar a getMyOrganization por su
// cuenta — la MISMA validación (clerkId+organizationId, sin cambiar en
// ningún momento dentro de esta función síncrona) repetida hasta 4 veces.
// Cada service sigue validando que el contexto recibido coincide con lo que
// ESA llamada puntual pide antes de confiar en él (ver resolveContext en
// event.service.js) — nunca se debilitó ninguna autorización, sólo se dejó
// de repetir una consulta cuyo resultado ya se conocía.
export async function commit(clerkId, draftEvent, action, organizationId = null) {
    try {
        const context = await getMyOrganization(clerkId, organizationId);
        if (!context) {
            throw new Error("NO_ORGANIZATION");
        }

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
            organizationId,
            { context }
        );

        // Fase 3O — perf: acá nunca se usa el evento que devuelven estas dos
        // llamadas (se pisa más abajo con updateMyEventService/
        // getEventWithDetailsById), así que `returnEvent: false` les ahorra
        // el findUnique con EVENT_DETAIL_INCLUDE que iban a descartar igual.
        // Ver el comentario de cada service en event.service.js.
        const links = buildLinksInput(draftEvent);
        if (links.length > 0) {
            await syncEventLinksService(clerkId, event.id, links, organizationId, { returnEvent: false, context });
        }

        // Fase 8.2 (perf) — `skipDelete: true`: `event.id` se creó dos líneas
        // más arriba, EN ESTA MISMA llamada a commit() — no puede existir
        // ninguna función/tipo de entrada previa que
        // eventFunction.deleteMany/ticketType.deleteMany fueran a encontrar.
        // Ver el comentario completo junto a `skipDelete` en
        // syncEventScheduleService (event.service.js).
        await syncEventScheduleService(
            clerkId,
            event.id,
            {
                functions: buildFunctionsInput(draftEvent),
                ticketTypes: buildTicketTypesInput(draftEvent),
            },
            organizationId,
            { returnEvent: false, context, skipDelete: true }
        );

        if (action === "PUBLISH") {
            event = await updateMyEventService(clerkId, event.id, { status: "PUBLISHED" }, organizationId, { context });
        } else {
            // FASE 3 (perf PREVIEW_DRAFT) — antes esto era getMyEventByIdService
            // (clerkId, event.id, organizationId), que vuelve a resolver
            // User+Organization y corre el self-heal de archivado por su
            // cuenta: ambos son redundantes acá (ver justificación completa en
            // event.service.js#getEventWithDetailsById). Rama exclusiva de
            // DRAFT — la rama PUBLISH de arriba no se toca.
            event = await getEventWithDetailsById(event.id);
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
