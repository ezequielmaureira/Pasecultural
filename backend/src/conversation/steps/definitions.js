import { randomUUID } from "node:crypto";
import { EVENT_CATEGORIES, SOCIAL_NETWORKS } from "../../utils/eventCategories.js";

// Cada StepDefinition es un objeto de datos, no una clase, y todos cumplen
// el MISMO contrato — sin excepciones por tipo de dato:
//
//   id            string único
//   section       a qué sección pertenece (ver steps/sections.js)
//   inputType     qué componente de respuesta usar en el frontend
//   buildPrompt(draft) -> { text, ...extra }   texto/opciones a mostrar
//   getValue(draft)    -> el valor ya confirmado para este paso (o
//                         undefined si todavía no se respondió). Es la
//                         única fuente para precargar un paso, sea al
//                         avanzar, volver, saltar a una sección o editar
//                         desde el preview — no hay un mecanismo aparte.
//   setValue(draft, value) -> nuevo draft con ese valor aplicado. Nunca
//                         debe asumir en qué paso estaba el usuario antes:
//                         sólo transforma draft + value.
//   next(draft, value)    -> stepId siguiente. Casi siempre alcanza con
//                         mirar `draft` (ya actualizado por setValue);
//                         `value` es sólo para bifurcaciones cuya elección
//                         no amerita guardarse como un campo durable del
//                         evento (ej. "elegí SINGLE/MULTIPLE/RECURRING").
//
// No existe loopStack ni ningún estado fuera de `draft`. Los pasos que
// arman un ítem de una lista de a poco (una entrada, un link social, una
// función) guardan su borrador en curso en un campo del propio draft
// prefijado con "_" (ej. `_ticketDraft`) — nunca se pierde ni se reinicia
// solo por navegar, y se limpia del draft antes de mandarlo al frontend o
// de persistir el evento (ver EventCreationEngine.js:toPreviewDraft y
// EventServicePort.js, que sólo lee campos explícitos, nunca hace spread
// del draft completo).

export const FIRST_STEP_ID = "NAME";
export const PREVIEW_STEP_ID = "PREVIEW";

function categoryOptions() {
    return EVENT_CATEGORIES.map((c) => ({ id: c.id, label: c.label }));
}

function socialNetworkOptions() {
    return SOCIAL_NETWORKS.map((s) => ({ id: s.id, label: s.label }));
}

// Identidad estable de un ítem en construcción dentro de una lista (una
// entrada, un link social) mientras dura su propia sub-cadena de preguntas.
// Se asigna una sola vez al empezar el ítem y viaja pegada al borrador — es
// lo que permite que el paso "commit" (TICKET_QUANTITY, SOCIAL_URL)
// actualice el ítem correcto en vez de agregar uno nuevo si el usuario
// vuelve atrás y reconfirma una respuesta ya cargada. Nunca se persiste.
function withItemKey(scratch) {
    return scratch?._key ? scratch : { ...scratch, _key: randomUUID() };
}

// "Commit" de un ítem a una lista del draft: si ya existe un ítem con el
// mismo _key (el usuario está reconfirmando uno ya cargado), lo reemplaza
// en el lugar; si no, lo agrega. Así ningún paso de tipo "agregar a una
// lista" duplica datos al revisitarse.
function upsertItem(list, item) {
    const index = list.findIndex((existing) => existing._key === item._key);
    if (index === -1) return [...list, item];
    return list.map((existing, i) => (i === index ? item : existing));
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
        section: "INFO",
        inputType: "SHORT_TEXT",
        buildPrompt: () => ({ text: "¿Cómo se llama tu evento?" }),
        getValue: (draft) => draft.title,
        setValue: (draft, value) => ({ ...draft, title: value }),
        next: () => "DESCRIPTION",
    },

    DESCRIPTION: {
        id: "DESCRIPTION",
        section: "INFO",
        inputType: "SHORT_TEXT",
        buildPrompt: () => ({ text: "Contanos de qué trata tu evento." }),
        getValue: (draft) => draft.description,
        setValue: (draft, value) => ({ ...draft, description: value }),
        next: () => "CATEGORY",
    },

    CATEGORY: {
        id: "CATEGORY",
        section: "INFO",
        inputType: "SINGLE_SELECT",
        buildPrompt: () => ({ text: "Elegí la categoría de tu evento.", options: categoryOptions() }),
        getValue: (draft) => draft.category,
        setValue: (draft, value) => ({ ...draft, category: value }),
        next: (draft) => (draft.category === "OTRO" ? "CUSTOM_CATEGORY" : "COVER_IMAGE"),
    },

    CUSTOM_CATEGORY: {
        id: "CUSTOM_CATEGORY",
        section: "INFO",
        inputType: "SHORT_TEXT",
        buildPrompt: () => ({ text: "Contanos de qué categoría se trata." }),
        getValue: (draft) => draft.customCategory,
        setValue: (draft, value) => ({ ...draft, customCategory: value }),
        next: () => "COVER_IMAGE",
    },

    COVER_IMAGE: {
        id: "COVER_IMAGE",
        section: "IMAGEN",
        inputType: "IMAGE_URL",
        // Campo suelto (no encadena otras preguntas relacionadas): al
        // editarlo desde el preview, el motor vuelve directo a PREVIEW en
        // vez de seguir el orden normal de creación (ver EventCreationEngine).
        editReturnsToPreview: true,
        buildPrompt: () => ({ text: "Mandame la imagen principal de tu evento." }),
        getValue: (draft) => draft.coverImage,
        setValue: (draft, value) => ({ ...draft, coverImage: value }),
        next: () => "LOCATION",
    },

    LOCATION: {
        id: "LOCATION",
        section: "UBICACION",
        inputType: "LOCATION",
        buildPrompt: () => ({ text: "¿Dónde es el evento? Necesito dirección, ciudad y provincia." }),
        getValue: (draft) => draft.location,
        setValue: (draft, value) => ({ ...draft, location: value }),
        next: () => "FUNCTIONS_MODE",
    },

    // Sirve igual para un recital de una sola fecha que para una temporada
    // de teatro con 40 funciones: la única diferencia es cuántos clics hacen
    // falta para cargarlas, no una lógica distinta por tipo de evento. Las
    // tres ramas arman la agenda en `draft._functionsDraft` (borrador en
    // curso, nunca visible fuera del motor) y recién se confirma a
    // `draft.functions` al tocar "Continuar" en FUNCTIONS_LIST.
    FUNCTIONS_MODE: {
        id: "FUNCTIONS_MODE",
        section: "FECHA",
        inputType: "SINGLE_SELECT",
        buildPrompt: () => ({
            text: "¿Cómo se realizarán las funciones de este evento?",
            options: [
                { id: "SINGLE", label: "Una sola función" },
                { id: "MULTIPLE", label: "Varias funciones" },
                { id: "RECURRING", label: "Funciones recurrentes" },
            ],
        }),
        getValue: (draft) => draft._functionsDraft?.mode,
        // Precarga con lo que ya estaba guardado en draft.functions: si el
        // organizador vuelve acá (Volver, o saltando a la sección) no
        // pierde las funciones que ya había cargado.
        setValue: (draft, value) => ({
            ...draft,
            _functionsDraft: { mode: value, slots: draft.functions ?? [] },
        }),
        next: (draft, value) => {
            if (value === "SINGLE") return "FUNCTIONS_SINGLE_CARD";
            if (value === "RECURRING") return "FUNCTIONS_RANGE";
            return "FUNCTIONS_LIST";
        },
    },

    FUNCTIONS_SINGLE_CARD: {
        id: "FUNCTIONS_SINGLE_CARD",
        section: "FECHA",
        inputType: "FUNCTION_CARD",
        buildPrompt: () => ({ text: "Contame cuándo es la función." }),
        getValue: (draft) => draft._functionsDraft?.slots?.[0],
        setValue: (draft, value) => ({
            ...draft,
            _functionsDraft: { ...draft._functionsDraft, slots: [value] },
        }),
        next: () => "FUNCTIONS_LIST",
    },

    FUNCTIONS_RANGE: {
        id: "FUNCTIONS_RANGE",
        section: "FECHA",
        inputType: "DATE_RANGE",
        buildPrompt: () => ({ text: "¿Desde y hasta qué fecha se repiten las funciones?" }),
        getValue: (draft) => {
            const fd = draft._functionsDraft;
            return fd?.from ? { from: fd.from, to: fd.to } : undefined;
        },
        setValue: (draft, value) => ({
            ...draft,
            _functionsDraft: { ...draft._functionsDraft, from: value.from, to: value.to },
        }),
        next: () => "FUNCTIONS_WEEKDAYS",
    },

    FUNCTIONS_WEEKDAYS: {
        id: "FUNCTIONS_WEEKDAYS",
        section: "FECHA",
        inputType: "WEEKDAYS",
        buildPrompt: () => ({ text: "¿Qué días de la semana?" }),
        getValue: (draft) => draft._functionsDraft?.weekdays,
        setValue: (draft, value) => ({
            ...draft,
            _functionsDraft: { ...draft._functionsDraft, weekdays: value },
        }),
        next: () => "FUNCTIONS_RECURRING_SCHEDULES",
    },

    // Uno o varios horarios para la misma recurrencia (ej. cine con función
    // a las 18:00 y a las 21:00 los mismos días): el motor arma el producto
    // cartesiano días × horarios. No se guardan solas: van al mismo
    // "administrador de agenda" que "Varias funciones" para poder
    // revisarlas/editarlas antes de confirmar.
    FUNCTIONS_RECURRING_SCHEDULES: {
        id: "FUNCTIONS_RECURRING_SCHEDULES",
        section: "FECHA",
        inputType: "TIME_RANGE_LIST",
        buildPrompt: () => ({ text: "¿A qué horarios se hace la función esos días?" }),
        getValue: (draft) => draft._functionsDraft?.schedules,
        setValue: (draft, value) => {
            const fd = draft._functionsDraft ?? {};
            const slots = generateRecurringSlots(fd.from, fd.to, fd.weekdays, value);
            return { ...draft, _functionsDraft: { ...fd, schedules: value, slots } };
        },
        next: () => "FUNCTIONS_LIST",
    },

    // Administrador de Agenda: paso terminal único al que llegan las tres
    // ramas (una sola función, varias, recurrentes). "Continuar" confirma
    // la lista tal como quedó editada a `draft.functions` y descarta el
    // borrador en curso (ya no hace falta, la lista confirmada es la nueva
    // fuente de verdad).
    FUNCTIONS_LIST: {
        id: "FUNCTIONS_LIST",
        section: "FECHA",
        inputType: "FUNCTIONS_LIST",
        buildPrompt: (draft) => ({
            text: "Administrador de Agenda",
            slots: draft._functionsDraft?.slots ?? draft.functions ?? [],
        }),
        getValue: (draft) => draft._functionsDraft?.slots ?? draft.functions,
        setValue: (draft, value) => {
            const { _functionsDraft, ...rest } = draft;
            return { ...rest, functions: value };
        },
        next: () => "EVENT_PRICING_TYPE",
    },

    // Primero preguntamos gratis/pago (cómo piensa el organizador su evento)
    // en vez de "¿tendrá entradas?" (pregunta de implementación). El "sí,
    // tendrá entradas" del flujo viejo pasa a ser implícito en la rama PAID.
    EVENT_PRICING_TYPE: {
        id: "EVENT_PRICING_TYPE",
        section: "ENTRADAS",
        inputType: "SINGLE_SELECT",
        buildPrompt: () => ({
            text: "¿Este evento es gratuito o de pago?",
            options: [
                { id: "FREE", label: "Gratuito" },
                { id: "PAID", label: "De pago" },
            ],
        }),
        getValue: (draft) => {
            if (draft.hasTickets === undefined) return undefined;
            return draft.hasTickets ? "PAID" : "FREE";
        },
        setValue: (draft, value) => {
            if (value === "PAID") {
                // Si el organizador vuelve acá y reconfirma "De pago" no se
                // pierden las entradas que ya había cargado (sólo arranca
                // vacío la primera vez que elige esta rama).
                return { ...draft, hasTickets: true, ticketTypes: draft.hasTickets ? draft.ticketTypes ?? [] : [] };
            }
            return { ...draft, hasTickets: false, ticketTypes: draft.ticketTypes ?? [] };
        },
        next: (draft, value) => (value === "PAID" ? "TICKET_NAME" : "WANTS_FREE_TICKETS"),
    },

    WANTS_FREE_TICKETS: {
        id: "WANTS_FREE_TICKETS",
        section: "ENTRADAS",
        inputType: "YES_NO",
        buildPrompt: () => ({ text: "¿Querés emitir entradas gratuitas para controlar el acceso?" }),
        // Campo propio (no reutiliza `hasTickets`, que ya lo pisa
        // EVENT_PRICING_TYPE con otro sentido) para poder distinguir "no
        // contestado todavía" de "contestó que no".
        getValue: (draft) => draft.wantsFreeTickets,
        setValue: (draft, value) => ({
            ...draft,
            wantsFreeTickets: value,
            hasTickets: value,
            ticketTypes: value ? draft.ticketTypes ?? [] : [],
        }),
        next: (draft, value) => (value ? "FREE_TICKET_QUANTITY" : "PROMO_VIDEO_ASK"),
    },

    // Entrada gratuita: un único tipo, sin nombre ni precio a pedir (siempre
    // "Entrada gratuita" a $0), sólo el stock disponible.
    FREE_TICKET_QUANTITY: {
        id: "FREE_TICKET_QUANTITY",
        section: "ENTRADAS",
        inputType: "POSITIVE_INT",
        buildPrompt: () => ({ text: "¿Cuántas entradas gratuitas vas a emitir?" }),
        getValue: (draft) =>
            draft.ticketTypes?.[0]?.name === "Entrada gratuita" ? draft.ticketTypes[0].quantity : undefined,
        setValue: (draft, value) => ({
            ...draft,
            ticketTypes: [{ name: "Entrada gratuita", price: 0, quantity: value }],
        }),
        next: () => "PROMO_VIDEO_ASK",
    },

    // Tipos habituales como tarjetas para elegir con un click; "Otro" deriva
    // a TICKET_NAME_CUSTOM para que el organizador escriba el nombre que
    // necesite (categorías propias, ej. "Mesa VIP", "Preventa 1").
    TICKET_NAME: {
        id: "TICKET_NAME",
        section: "ENTRADAS",
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
        getValue: (draft) => draft._ticketDraft?.name,
        setValue: (draft, value) => {
            const scratch = withItemKey(draft._ticketDraft);
            if (value === "OTHER") return { ...draft, _ticketDraft: scratch };
            return { ...draft, _ticketDraft: { ...scratch, name: value } };
        },
        next: (draft, value) => (value === "OTHER" ? "TICKET_NAME_CUSTOM" : "TICKET_PRICE"),
    },

    TICKET_NAME_CUSTOM: {
        id: "TICKET_NAME_CUSTOM",
        section: "ENTRADAS",
        inputType: "SHORT_TEXT",
        buildPrompt: () => ({ text: "¿Cómo se llama esta entrada?" }),
        getValue: (draft) => draft._ticketDraft?.name,
        setValue: (draft, value) => ({
            ...draft,
            _ticketDraft: { ...withItemKey(draft._ticketDraft), name: value },
        }),
        next: () => "TICKET_PRICE",
    },

    TICKET_PRICE: {
        id: "TICKET_PRICE",
        section: "ENTRADAS",
        inputType: "PRICE",
        buildPrompt: () => ({ text: "¿Qué precio tiene?" }),
        getValue: (draft) => draft._ticketDraft?.price,
        setValue: (draft, value) => ({
            ...draft,
            _ticketDraft: { ...draft._ticketDraft, price: value },
        }),
        next: () => "TICKET_QUANTITY",
    },

    // "Commit" del tipo de entrada: upsert por _key en vez de un push ciego,
    // así que si el usuario vuelve acá (Volver, o saltando a la sección) a
    // revisar o corregir un tipo ya cargado y confirma, actualiza ese mismo
    // ítem en vez de duplicarlo. El borrador en curso NO se limpia acá —
    // sigue representando "la entrada que se está editando ahora mismo", así
    // que si se vuelve a cualquier paso anterior de esta misma entrada
    // (nombre, precio) los datos siguen disponibles para precargar.
    TICKET_QUANTITY: {
        id: "TICKET_QUANTITY",
        section: "ENTRADAS",
        inputType: "POSITIVE_INT",
        buildPrompt: () => ({ text: "¿Cuántas hay disponibles?" }),
        getValue: (draft) => draft._ticketDraft?.quantity,
        setValue: (draft, value) => {
            const completedTicket = { ...draft._ticketDraft, quantity: value };
            const ticketTypes = upsertItem(draft.ticketTypes ?? [], completedTicket);
            return { ...draft, ticketTypes, _ticketDraft: completedTicket };
        },
        next: () => "ADD_ANOTHER_TICKET",
    },

    ADD_ANOTHER_TICKET: {
        id: "ADD_ANOTHER_TICKET",
        section: "ENTRADAS",
        inputType: "SINGLE_SELECT",
        buildPrompt: () => ({
            text: "¿Querés agregar otro tipo de entrada?",
            options: [
                { id: "ADD", label: "Agregar otro tipo" },
                { id: "CONTINUE", label: "Continuar" },
            ],
        }),
        // Es un paso de navegación pura (no guarda un dato propio del
        // evento), por eso no tiene un valor "confirmado" que precargar.
        getValue: () => undefined,
        // Recién acá arranca un ítem realmente nuevo: se limpia el
        // borrador (con él, su _key) para que la próxima entrada no herede
        // la identidad de la anterior.
        setValue: (draft, value) => ({ ...draft, _ticketDraft: value === "ADD" ? {} : draft._ticketDraft }),
        next: (draft, value) => (value === "ADD" ? "TICKET_NAME" : "PROMO_VIDEO_ASK"),
    },

    PROMO_VIDEO_ASK: {
        id: "PROMO_VIDEO_ASK",
        section: "VIDEO",
        inputType: "YES_NO",
        buildPrompt: () => ({ text: "¿Querés agregar un video promocional de YouTube?" }),
        getValue: (draft) => draft.wantsPromoVideo,
        setValue: (draft, value) => ({ ...draft, wantsPromoVideo: value }),
        next: (draft) => (draft.wantsPromoVideo ? "PROMO_VIDEO_URL" : "SOCIAL_LINKS_ASK"),
    },

    PROMO_VIDEO_URL: {
        id: "PROMO_VIDEO_URL",
        section: "VIDEO",
        inputType: "YOUTUBE_URL",
        buildPrompt: () => ({ text: "Pasame el link del video (video o Short de YouTube)." }),
        getValue: (draft) => draft.promoVideoUrl,
        setValue: (draft, value) => ({ ...draft, promoVideoUrl: value }),
        next: () => "SOCIAL_LINKS_ASK",
    },

    SOCIAL_LINKS_ASK: {
        id: "SOCIAL_LINKS_ASK",
        section: "REDES",
        inputType: "YES_NO",
        buildPrompt: () => ({ text: "¿Querés agregar redes sociales?" }),
        getValue: (draft) => draft.wantsSocialLinks,
        setValue: (draft, value) => ({
            ...draft,
            wantsSocialLinks: value,
            socialLinks: draft.socialLinks ?? [],
        }),
        next: (draft, value) => (value ? "SOCIAL_NETWORK" : "PREVIEW"),
    },

    SOCIAL_NETWORK: {
        id: "SOCIAL_NETWORK",
        section: "REDES",
        inputType: "SINGLE_SELECT",
        buildPrompt: () => ({ text: "¿Qué red querés agregar?", options: socialNetworkOptions() }),
        getValue: (draft) => draft._socialDraft?.network,
        setValue: (draft, value) => ({
            ...draft,
            _socialDraft: { ...withItemKey(draft._socialDraft), network: value },
        }),
        next: () => "SOCIAL_URL",
    },

    // Mismo criterio que TICKET_QUANTITY: upsert por _key, el borrador no se
    // limpia acá (sigue siendo "el link que se está editando ahora").
    SOCIAL_URL: {
        id: "SOCIAL_URL",
        section: "REDES",
        inputType: "URL",
        buildPrompt: (draft) => ({ text: `Pasame el link de ${draft._socialDraft?.network ?? "esa red"}.` }),
        getValue: (draft) => draft._socialDraft?.url,
        setValue: (draft, value) => {
            const completedLink = { ...draft._socialDraft, url: value };
            const socialLinks = upsertItem(draft.socialLinks ?? [], completedLink);
            return { ...draft, socialLinks, _socialDraft: completedLink };
        },
        next: () => "ADD_ANOTHER_SOCIAL",
    },

    ADD_ANOTHER_SOCIAL: {
        id: "ADD_ANOTHER_SOCIAL",
        section: "REDES",
        inputType: "YES_NO",
        buildPrompt: () => ({ text: "¿Querés agregar otra red?" }),
        getValue: () => undefined,
        setValue: (draft, value) => ({ ...draft, _socialDraft: value ? {} : draft._socialDraft }),
        next: (draft, value) => (value ? "SOCIAL_NETWORK" : "PREVIEW"),
    },
};

export function getStep(stepId) {
    const step = STEPS[stepId];
    if (!step) {
        throw new Error(`UNKNOWN_STEP: ${stepId}`);
    }
    return step;
}
