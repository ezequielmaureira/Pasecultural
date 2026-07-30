import { EVENT_CATEGORIES, SOCIAL_NETWORKS } from "../../utils/eventCategories.js";

// Cada StepDefinition es un objeto de datos, no una clase: agregar un paso
// nuevo al flujo (ej. "accesibilidad") es agregar una entrada acá, sin tocar
// EventCreationEngine.js (OCP). "next" decide el siguiente paso mirando el
// draft/loopStack ya actualizados; los grupos repetibles (funciones, tipos
// de entrada, redes) usan `loopStack` como una pila de contextos de loop.

export const FIRST_STEP_ID = "NAME";
export const PREVIEW_STEP_ID = "PREVIEW";

function categoryOptions() {
    return EVENT_CATEGORIES.map((c) => ({ id: c.id, label: c.label }));
}

function socialNetworkOptions() {
    return SOCIAL_NETWORKS.map((s) => ({ id: s.id, label: s.label }));
}

function topLoop(loopStack) {
    return loopStack[loopStack.length - 1] ?? null;
}

function replaceTopLoop(loopStack, nextLoop) {
    const copy = loopStack.slice(0, -1);
    if (nextLoop) copy.push(nextLoop);
    return copy;
}

// Recorre día por día el rango [from, to] (ambos ISO) y arma una función por
// cada combinación de (día cuyo día de semana esté en `weekdays`, horario de
// `schedules`) — así "Viernes/Sábado" + "18:00-20:00 y 21:00-23:00" genera
// las 4 funciones semanales sin repetir el asistente por cada horario.
// 0=Lunes..6=Domingo, misma convención que usa el calendario del frontend.
function generateRecurringSlots(from, to, weekdays, schedules) {
    const weekdaySet = new Set(weekdays);
    const slots = [];
    const end = new Date(to).getTime();

    for (let cursor = new Date(from); cursor.getTime() <= end; cursor.setDate(cursor.getDate() + 1)) {
        const isoWeekday = (cursor.getDay() + 6) % 7;
        if (!weekdaySet.has(isoWeekday)) continue;

        const isoDate = new Date(cursor).toISOString();
        for (const { startTime, endTime } of schedules) {
            slots.push({ date: isoDate, startTime, endTime });
        }
    }

    return slots;
}

export const STEPS = {
    NAME: {
        id: "NAME",
        inputType: "SHORT_TEXT",
        buildPrompt: () => ({ text: "¿Cómo se llama tu evento?" }),
        // Precarga lo ya cargado: si el organizador vuelve a esta pregunta
        // (botón "Volver" o "Editar" desde el preview), no la ve en blanco
        // y tiene que retipear lo que ya había puesto.
        getCurrentValue: (draft) => draft.title,
        apply: (draft, loopStack, value) => ({ draft: { ...draft, title: value }, loopStack }),
        next: () => "DESCRIPTION",
    },

    DESCRIPTION: {
        id: "DESCRIPTION",
        inputType: "SHORT_TEXT",
        buildPrompt: () => ({ text: "Contanos de qué trata tu evento." }),
        getCurrentValue: (draft) => draft.description,
        apply: (draft, loopStack, value) => ({ draft: { ...draft, description: value }, loopStack }),
        next: () => "CATEGORY",
    },

    CATEGORY: {
        id: "CATEGORY",
        inputType: "SINGLE_SELECT",
        buildPrompt: () => ({ text: "Elegí la categoría de tu evento.", options: categoryOptions() }),
        getCurrentValue: (draft) => draft.category,
        apply: (draft, loopStack, value) => ({ draft: { ...draft, category: value }, loopStack }),
        next: (draft) => (draft.category === "OTRO" ? "CUSTOM_CATEGORY" : "COVER_IMAGE"),
    },

    CUSTOM_CATEGORY: {
        id: "CUSTOM_CATEGORY",
        inputType: "SHORT_TEXT",
        buildPrompt: () => ({ text: "Contanos de qué categoría se trata." }),
        getCurrentValue: (draft) => draft.customCategory,
        apply: (draft, loopStack, value) => ({ draft: { ...draft, customCategory: value }, loopStack }),
        next: () => "COVER_IMAGE",
    },

    COVER_IMAGE: {
        id: "COVER_IMAGE",
        inputType: "IMAGE_URL",
        // Campo suelto (no encadena otras preguntas relacionadas): al
        // editarlo desde el preview, el motor vuelve directo a PREVIEW en
        // vez de seguir el orden normal de creación (ver EventCreationEngine).
        editReturnsToPreview: true,
        buildPrompt: () => ({ text: "Mandame la imagen principal de tu evento." }),
        getCurrentValue: (draft) => draft.coverImage,
        apply: (draft, loopStack, value) => ({ draft: { ...draft, coverImage: value }, loopStack }),
        next: () => "LOCATION",
    },

    LOCATION: {
        id: "LOCATION",
        inputType: "LOCATION",
        buildPrompt: () => ({ text: "¿Dónde es el evento? Necesito dirección, ciudad y provincia." }),
        getCurrentValue: (draft) => draft.location,
        apply: (draft, loopStack, value) => ({ draft: { ...draft, location: value }, loopStack }),
        next: () => "FUNCTIONS_MODE",
    },

    // Sirve igual para un recital de una sola fecha que para una temporada
    // de teatro con 40 funciones: la única diferencia es cuántos clics hacen
    // falta para cargarlas, no una lógica distinta por tipo de evento.
    // Todas las ramas arman la lista de funciones en `loopStack.buffer.slots`
    // (mismo mecanismo de "borrador temporal" que ya usan los loops de
    // Entradas/Redes) y recién se confirma a `draft.functions` al tocar
    // "Continuar" en FUNCTIONS_LIST (el Administrador de Agenda) — las tres
    // ramas terminan ahí siempre, así nunca se pierde lo ya cargado.
    FUNCTIONS_MODE: {
        id: "FUNCTIONS_MODE",
        inputType: "SINGLE_SELECT",
        buildPrompt: () => ({
            text: "¿Cómo se realizarán las funciones de este evento?",
            options: [
                { id: "SINGLE", label: "Una sola función" },
                { id: "MULTIPLE", label: "Varias funciones" },
                { id: "RECURRING", label: "Funciones recurrentes" },
            ],
        }),
        // Precarga con lo que ya estaba guardado en draft.functions (si el
        // organizador vuelve acá desde "Editar" en la vista previa general
        // del evento, no pierde las funciones que ya había cargado).
        apply: (draft, loopStack) => ({
            draft,
            loopStack: [...loopStack, { type: "FUNCTIONS_BUILD", buffer: { slots: draft.functions ?? [] } }],
        }),
        next: (draft, loopStack, value) => {
            if (value === "SINGLE") return "FUNCTIONS_SINGLE_CARD";
            if (value === "RECURRING") return "FUNCTIONS_RANGE";
            return "FUNCTIONS_LIST";
        },
    },

    FUNCTIONS_SINGLE_CARD: {
        id: "FUNCTIONS_SINGLE_CARD",
        inputType: "FUNCTION_CARD",
        buildPrompt: () => ({ text: "Contame cuándo es la función." }),
        apply: (draft, loopStack, value) => {
            const loop = topLoop(loopStack);
            const nextLoop = { ...loop, buffer: { ...loop.buffer, slots: [value] } };
            return { draft, loopStack: replaceTopLoop(loopStack, nextLoop) };
        },
        next: () => "FUNCTIONS_LIST",
    },

    FUNCTIONS_RANGE: {
        id: "FUNCTIONS_RANGE",
        inputType: "DATE_RANGE",
        buildPrompt: () => ({ text: "¿Desde y hasta qué fecha se repiten las funciones?" }),
        apply: (draft, loopStack, value) => {
            const loop = topLoop(loopStack);
            const nextLoop = { ...loop, buffer: { ...loop.buffer, from: value.from, to: value.to } };
            return { draft, loopStack: replaceTopLoop(loopStack, nextLoop) };
        },
        next: () => "FUNCTIONS_WEEKDAYS",
    },

    FUNCTIONS_WEEKDAYS: {
        id: "FUNCTIONS_WEEKDAYS",
        inputType: "WEEKDAYS",
        buildPrompt: () => ({ text: "¿Qué días de la semana?" }),
        apply: (draft, loopStack, value) => {
            const loop = topLoop(loopStack);
            const nextLoop = { ...loop, buffer: { ...loop.buffer, weekdays: value } };
            return { draft, loopStack: replaceTopLoop(loopStack, nextLoop) };
        },
        next: () => "FUNCTIONS_RECURRING_SCHEDULES",
    },

    // Uno o varios horarios para la misma recurrencia (ej. cine con función
    // a las 18:00 y a las 21:00 los mismos días): el motor arma el producto
    // cartesiano días × horarios. No se guardan solas: van al mismo
    // "administrador de agenda" que "Varias funciones" para poder
    // revisarlas/editarlas antes de confirmar — la recurrencia sólo genera
    // el punto de partida de la agenda.
    FUNCTIONS_RECURRING_SCHEDULES: {
        id: "FUNCTIONS_RECURRING_SCHEDULES",
        inputType: "TIME_RANGE_LIST",
        buildPrompt: () => ({ text: "¿A qué horarios se hace la función esos días?" }),
        apply: (draft, loopStack, value) => {
            const loop = topLoop(loopStack);
            const slots = generateRecurringSlots(loop.buffer.from, loop.buffer.to, loop.buffer.weekdays, value);
            const nextLoop = { ...loop, buffer: { ...loop.buffer, slots } };
            return { draft, loopStack: replaceTopLoop(loopStack, nextLoop) };
        },
        next: () => "FUNCTIONS_LIST",
    },

    // Administrador de Agenda: paso terminal único al que llegan las tres
    // ramas (una sola función, varias, recurrentes). "Continuar" confirma
    // la lista tal como quedó editada a `draft.functions`; "Volver" ya lo
    // resuelve el mecanismo genérico de ConversationView (canGoBack), no
    // hace falta un botón aparte acá.
    FUNCTIONS_LIST: {
        id: "FUNCTIONS_LIST",
        inputType: "FUNCTIONS_LIST",
        buildPrompt: (draft, loopStack) => {
            const loop = topLoop(loopStack);
            return {
                text: "Administrador de Agenda",
                slots: loop?.buffer?.slots ?? [],
            };
        },
        apply: (draft, loopStack, value) => ({
            draft: { ...draft, functions: value },
            loopStack: loopStack.slice(0, -1),
        }),
        next: () => "EVENT_PRICING_TYPE",
    },

    // Primero preguntamos gratis/pago (cómo piensa el organizador su evento)
    // en vez de "¿tendrá entradas?" (pregunta de implementación). El "sí,
    // tendrá entradas" del flujo viejo pasa a ser implícito en la rama PAID.
    EVENT_PRICING_TYPE: {
        id: "EVENT_PRICING_TYPE",
        inputType: "SINGLE_SELECT",
        buildPrompt: () => ({
            text: "¿Este evento es gratuito o de pago?",
            options: [
                { id: "FREE", label: "Gratuito" },
                { id: "PAID", label: "De pago" },
            ],
        }),
        apply: (draft, loopStack, value) => {
            if (value === "PAID") {
                return {
                    draft: { ...draft, hasTickets: true, ticketTypes: [] },
                    loopStack: [...loopStack, { type: "TICKETS", buffer: {} }],
                };
            }
            return { draft: { ...draft, ticketTypes: draft.ticketTypes ?? [] }, loopStack };
        },
        next: (draft, loopStack, value) => (value === "PAID" ? "TICKET_NAME" : "WANTS_FREE_TICKETS"),
    },

    WANTS_FREE_TICKETS: {
        id: "WANTS_FREE_TICKETS",
        inputType: "YES_NO",
        buildPrompt: () => ({ text: "¿Querés emitir entradas gratuitas para controlar el acceso?" }),
        apply: (draft, loopStack, value) => ({
            draft: { ...draft, hasTickets: value, ticketTypes: value ? draft.ticketTypes ?? [] : [] },
            loopStack,
        }),
        next: (draft, loopStack, value) => (value ? "FREE_TICKET_QUANTITY" : "PROMO_VIDEO_ASK"),
    },

    // Entrada gratuita: un único tipo, sin nombre ni precio a pedir (siempre
    // "Entrada gratuita" a $0), sólo el stock disponible.
    FREE_TICKET_QUANTITY: {
        id: "FREE_TICKET_QUANTITY",
        inputType: "POSITIVE_INT",
        buildPrompt: () => ({ text: "¿Cuántas entradas gratuitas vas a emitir?" }),
        apply: (draft, loopStack, value) => ({
            draft: { ...draft, ticketTypes: [{ name: "Entrada gratuita", price: 0, quantity: value }] },
            loopStack,
        }),
        next: () => "PROMO_VIDEO_ASK",
    },

    // Tipos habituales como tarjetas para elegir con un click; "Otro" deriva
    // a TICKET_NAME_CUSTOM para que el organizador escriba el nombre que
    // necesite (categorías propias, ej. "Mesa VIP", "Preventa 1").
    TICKET_NAME: {
        id: "TICKET_NAME",
        inputType: "SINGLE_SELECT",
        buildPrompt: (draft) => ({
            text: draft.ticketTypes?.length
                ? "¿Qué tipo de entrada querés agregar ahora?"
                : "¿Qué tipo de entrada querés agregar primero?",
            options: [
                { id: "General", label: "General" },
                { id: "VIP", label: "VIP" },
                { id: "Platea", label: "Platea" },
                { id: "Campo", label: "Campo" },
                { id: "Anticipada", label: "Anticipada" },
                { id: "Palco", label: "Palco" },
                { id: "Mesa", label: "Mesa" },
                { id: "OTHER", label: "Otro" },
            ],
        }),
        apply: (draft, loopStack, value) => {
            if (value === "OTHER") return { draft, loopStack };
            const loop = topLoop(loopStack);
            const nextLoop = { ...loop, buffer: { ...loop.buffer, name: value } };
            return { draft, loopStack: replaceTopLoop(loopStack, nextLoop) };
        },
        next: (draft, loopStack, value) => (value === "OTHER" ? "TICKET_NAME_CUSTOM" : "TICKET_PRICE"),
    },

    TICKET_NAME_CUSTOM: {
        id: "TICKET_NAME_CUSTOM",
        inputType: "SHORT_TEXT",
        buildPrompt: () => ({ text: "¿Cómo se llama esta entrada?" }),
        apply: (draft, loopStack, value) => {
            const loop = topLoop(loopStack);
            const nextLoop = { ...loop, buffer: { ...loop.buffer, name: value } };
            return { draft, loopStack: replaceTopLoop(loopStack, nextLoop) };
        },
        next: () => "TICKET_PRICE",
    },

    TICKET_PRICE: {
        id: "TICKET_PRICE",
        inputType: "PRICE",
        buildPrompt: () => ({ text: "¿Qué precio tiene?" }),
        apply: (draft, loopStack, value) => {
            const loop = topLoop(loopStack);
            const nextLoop = { ...loop, buffer: { ...loop.buffer, price: value } };
            return { draft, loopStack: replaceTopLoop(loopStack, nextLoop) };
        },
        next: () => "TICKET_QUANTITY",
    },

    TICKET_QUANTITY: {
        id: "TICKET_QUANTITY",
        inputType: "POSITIVE_INT",
        buildPrompt: () => ({ text: "¿Cuántas hay disponibles?" }),
        apply: (draft, loopStack, value) => {
            const loop = topLoop(loopStack);
            const completedTicket = { ...loop.buffer, quantity: value };
            const ticketTypes = [...draft.ticketTypes, completedTicket];
            const nextLoop = { ...loop, buffer: {} };
            return {
                draft: { ...draft, ticketTypes },
                loopStack: replaceTopLoop(loopStack, nextLoop),
            };
        },
        next: () => "ADD_ANOTHER_TICKET",
    },

    ADD_ANOTHER_TICKET: {
        id: "ADD_ANOTHER_TICKET",
        inputType: "SINGLE_SELECT",
        buildPrompt: () => ({
            text: "¿Querés agregar otro tipo de entrada?",
            options: [
                { id: "ADD", label: "Agregar otro tipo" },
                { id: "CONTINUE", label: "Continuar" },
            ],
        }),
        apply: (draft, loopStack, value) => ({
            draft,
            loopStack: value === "ADD" ? loopStack : loopStack.slice(0, -1),
        }),
        next: (draft, loopStack, value) => (value === "ADD" ? "TICKET_NAME" : "PROMO_VIDEO_ASK"),
    },

    PROMO_VIDEO_ASK: {
        id: "PROMO_VIDEO_ASK",
        inputType: "YES_NO",
        buildPrompt: () => ({ text: "¿Querés agregar un video promocional de YouTube?" }),
        apply: (draft, loopStack, value) => ({ draft: { ...draft, wantsPromoVideo: value }, loopStack }),
        next: (draft) => (draft.wantsPromoVideo ? "PROMO_VIDEO_URL" : "SOCIAL_LINKS_ASK"),
    },

    PROMO_VIDEO_URL: {
        id: "PROMO_VIDEO_URL",
        inputType: "YOUTUBE_URL",
        buildPrompt: () => ({ text: "Pasame el link del video (video o Short de YouTube)." }),
        apply: (draft, loopStack, value) => ({ draft: { ...draft, promoVideoUrl: value }, loopStack }),
        next: () => "SOCIAL_LINKS_ASK",
    },

    SOCIAL_LINKS_ASK: {
        id: "SOCIAL_LINKS_ASK",
        inputType: "YES_NO",
        buildPrompt: () => ({ text: "¿Querés agregar redes sociales?" }),
        apply: (draft, loopStack, value) => ({
            draft: { ...draft, socialLinks: draft.socialLinks ?? [] },
            loopStack: value ? [...loopStack, { type: "SOCIALS", buffer: {} }] : loopStack,
        }),
        next: (draft, loopStack, value) => (value ? "SOCIAL_NETWORK" : "PREVIEW"),
    },

    SOCIAL_NETWORK: {
        id: "SOCIAL_NETWORK",
        inputType: "SINGLE_SELECT",
        buildPrompt: () => ({ text: "¿Qué red querés agregar?", options: socialNetworkOptions() }),
        apply: (draft, loopStack, value) => {
            const loop = topLoop(loopStack);
            const nextLoop = { ...loop, buffer: { ...loop.buffer, network: value } };
            return { draft, loopStack: replaceTopLoop(loopStack, nextLoop) };
        },
        next: () => "SOCIAL_URL",
    },

    SOCIAL_URL: {
        id: "SOCIAL_URL",
        inputType: "URL",
        buildPrompt: (draft, loopStack) => {
            const loop = topLoop(loopStack);
            return { text: `Pasame el link de ${loop.buffer.network}.` };
        },
        apply: (draft, loopStack, value) => {
            const loop = topLoop(loopStack);
            const completedLink = { ...loop.buffer, url: value };
            const socialLinks = [...draft.socialLinks, completedLink];
            const nextLoop = { ...loop, buffer: {} };
            return {
                draft: { ...draft, socialLinks },
                loopStack: replaceTopLoop(loopStack, nextLoop),
            };
        },
        next: () => "ADD_ANOTHER_SOCIAL",
    },

    ADD_ANOTHER_SOCIAL: {
        id: "ADD_ANOTHER_SOCIAL",
        inputType: "YES_NO",
        buildPrompt: () => ({ text: "¿Querés agregar otra red?" }),
        apply: (draft, loopStack, value) => ({
            draft,
            loopStack: value ? loopStack : loopStack.slice(0, -1),
        }),
        next: (draft, loopStack, value) => (value ? "SOCIAL_NETWORK" : "PREVIEW"),
    },
};

export function getStep(stepId) {
    const step = STEPS[stepId];
    if (!step) {
        throw new Error(`UNKNOWN_STEP: ${stepId}`);
    }
    return step;
}
