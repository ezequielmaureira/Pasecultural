import { randomUUID } from "node:crypto";
import prisma from "../config/prisma.js";
import { generateUniqueSlug } from "../utils/generateSlug.js";
import { canPublishEvents } from "../utils/organizationTrust.js";
import { isValidHttpUrl, parseMediaUrl } from "../utils/mediaParser.js";
import { runArchiveSelfHeal } from "./eventArchive.service.js";
import { effectiveCapacity, SOLD_TICKET_STATUSES } from "./functionCapacity.service.js";
import { geocodeLocationIfNeeded } from "./geocoding.service.js";
import { timeExternalCall } from "../utils/whatsappPerf.js";

const UPDATABLE_FIELDS = [
    "title",
    "category",
    "customCategory",
    "shortDescription",
    "description",
    "coverImage",
    "venue",
    "address",
    "city",
    "province",
    "startDate",
    "endDate",
    "doorsOpenAt",
    "isFree",
];

const DATE_FIELDS = new Set(["startDate", "endDate", "doorsOpenAt"]);

async function getUserByClerkId(clerkId) {
    return prisma.user.findUnique({ where: { clerkId } });
}

// Fase 2G (WhatsApp Organizer): un mismo Clerk account puede ser owner de
// varias Organizations, así que "cuál Organization" dejó de poder inferirse
// siempre con findFirst — eso sólo alcanza mientras hay una sola. Cuando el
// caller YA SABE para cuál Organization está operando (ej. WhatsApp, que
// resuelve organizationId antes de arrancar el motor), lo pasa explícito acá
// y se exige pertenencia real (organization.ownerId === user.id); si no
// pertenece, esto es SIEMPRE un fallo duro — nunca se degrada de vuelta a
// findFirst con otra Organization del mismo usuario, eso sería operar sobre
// algo que el caller no pidió. findFirst queda reservado exclusivamente para
// organizationId === null (comportamiento legacy, todavía el único que usa
// la Web).
async function getMyOrganization(clerkId, organizationId = null) {
    const user = await getUserByClerkId(clerkId);
    if (!user) return null;

    if (organizationId) {
        const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
        if (!organization || organization.ownerId !== user.id) {
            throw new Error("ORGANIZATION_FORBIDDEN");
        }
        return { user, organization };
    }

    const organization = await prisma.organization.findFirst({
        where: { ownerId: user.id },
    });

    if (!organization) return null;

    return { user, organization };
}

function assertValidCoordinate(value, min, max, errorCode) {
    if (value === null || value === undefined || value === "") return;
    const n = Number(value);
    if (Number.isNaN(n) || n < min || n > max) {
        throw new Error(errorCode);
    }
}

// Construye los campos de ubicación (Google Maps) a partir del objeto
// `location` recibido del LocationPicker (Web, con coordenadas) o del
// formulario/flujo manual (Web sin mapa, o WhatsApp — sin coordenadas).
// Además sincroniza los campos legacy (venue/address/city/province) para no
// romper el marketplace público, que todavía lee esos campos denormalizados.
//
// Fase 3J — si llega sin latitude/longitude pero con address+city+province
// completos, intenta geocodificarla server-side antes de persistir
// (geocodeLocationIfNeeded, geocoding.service.js — reutilizable, ajeno a
// cualquier canal). Es best-effort: nunca lanza, nunca bloquea crear/editar
// el evento por no poder geocodificar (mismo comportamiento de antes de
// esta fase si falla: latitude/longitude quedan en null). Si YA hay
// coordenadas reales (WhatsApp compartido, o picker de Google Maps en la
// Web), nunca se geocodifica de nuevo — se conservan tal cual.
//
// Exportada ÚNICAMENTE para poder testear la cadena real completa
// (Web/WhatsApp → EventServicePort.buildLocationInput → ACÁ → objeto final
// que recibiría Prisma) sin depender de una base de datos real ni de mocks
// frágiles de módulos ES (este runtime de node:test no tiene mock.module()
// disponible para interceptar la importación de ../config/prisma.js) — es
// la única I/O real de esta función que SÍ es mockeable limpiamente
// (geocodeLocationIfNeeded llama a fetch, que los tests interceptan vía
// globalThis.fetch, mismo patrón que el resto del proyecto). No es parte de
// la API pública del módulo desde ningún otro caller real: `buildEventData`
// (el único llamador real) sigue siendo interna.
export async function buildLocationData(location) {
    if (!location || typeof location !== "object") return {};

    assertValidCoordinate(location.latitude, -90, 90, "INVALID_LATITUDE");
    assertValidCoordinate(location.longitude, -180, 180, "INVALID_LONGITUDE");

    const venueName = location.venueName?.trim() || null;
    const formattedAddress = location.formattedAddress?.trim() || null;
    const addressLine = location.addressLine?.trim() || null;
    const city = location.city?.trim() || null;
    const province = location.province?.trim() || null;
    const country = location.country?.trim() || null;

    const rawLatitude =
        location.latitude === null || location.latitude === undefined || location.latitude === "" ? null : Number(location.latitude);
    const rawLongitude =
        location.longitude === null || location.longitude === undefined || location.longitude === "" ? null : Number(location.longitude);
    const rawGooglePlaceId = location.googlePlaceId?.trim() || null;

    // Fase 3O — instrumentado: es I/O externo (fetch a Google, hasta 5s de
    // timeout, ver geocoding.service.js) que no pasa por Prisma, así que sin
    // esto queda invisible dentro de `dbCalls` — indistinguible de una
    // consulta lenta a Postgres en el desglose de [WA_PERF].
    const { latitude, longitude, googlePlaceId } = await timeExternalCall("geocoding.requestGeocode", () =>
        geocodeLocationIfNeeded({
            latitude: rawLatitude,
            longitude: rawLongitude,
            address: addressLine || formattedAddress,
            city,
            province,
            country,
            googlePlaceId: rawGooglePlaceId,
        })
    );

    return {
        venueName,
        formattedAddress,
        addressLine,
        city,
        province,
        country,
        postalCode: location.postalCode?.trim() || null,
        latitude,
        longitude,
        googlePlaceId,
        // Legacy: mantiene funcionando el marketplace público existente.
        venue: venueName,
        address: addressLine || formattedAddress,
        city,
        province,
    };
}

function assertValidCategory(input) {
    const category = Object.hasOwn(input, "category") ? input.category : undefined;
    if (category !== "OTRO") return;

    const customCategory = Object.hasOwn(input, "customCategory") ? input.customCategory : undefined;
    if (!customCategory || !customCategory.trim()) {
        throw new Error("CUSTOM_CATEGORY_REQUIRED");
    }
}

// Fase 3J — async porque buildLocationData ahora puede geocodificar
// (best-effort, con timeout corto, ver geocoding.service.js); ambos
// call-sites (createEventService/updateMyEventService) ya son async y
// esperan a `data` antes de tocar Prisma, así que el `await` acá no cambia
// ningún orden de operaciones existente.
async function buildEventData(input) {
    const data = {};
    for (const field of UPDATABLE_FIELDS) {
        if (Object.hasOwn(input, field)) {
            const value = input[field];
            if (DATE_FIELDS.has(field)) {
                data[field] = value ? new Date(value) : null;
            } else if (field === "isFree") {
                data[field] = Boolean(value);
            } else {
                data[field] = value || null;
            }
        }
    }

    if (Object.hasOwn(input, "location")) {
        Object.assign(data, await buildLocationData(input.location));
    }

    return data;
}

export const createEventService = async (clerkId, input, organizationId = null) => {
    const context = await getMyOrganization(clerkId, organizationId);
    if (!context) {
        throw new Error("NO_ORGANIZATION");
    }

    if (!input.title || !input.title.trim()) {
        throw new Error("TITLE_REQUIRED");
    }

    assertValidCategory(input);

    const slug = await generateUniqueSlug(input.title, async (candidate) => {
        const existing = await prisma.event.findUnique({ where: { slug: candidate } });
        return Boolean(existing);
    });

    const data = await buildEventData(input);

    return prisma.event.create({
        data: {
            ...data,
            title: input.title,
            slug,
            status: "DRAFT",
            organizationId: context.organization.id,
            createdBy: context.user.id,
        },
    });
};

// "Mis eventos" — SIEMPRE excluye archivados (espacio operativo, ver
// Historial de Eventos). Self-heal antes de la consulta real: si algo ya
// cumplió la regla de archivado pero todavía no tiene `archivedAt`, se
// marca acá mismo — así esta lista nunca muestra un evento que debería
// haber pasado al Historial, sin necesidad de un cron.
export const getMyEventsService = async (clerkId) => {
    const context = await getMyOrganization(clerkId);
    if (!context) return [];

    await runArchiveSelfHeal(prisma, { organizationId: context.organization.id });

    return prisma.event.findMany({
        where: { organizationId: context.organization.id, archivedAt: null },
        orderBy: { createdAt: "desc" },
    });
};

const EVENT_DETAIL_INCLUDE = {
    ticketTypes: { orderBy: { createdAt: "asc" } },
    functions: {
        orderBy: { date: "asc" },
        include: {
            ticketAssignments: {
                include: { ticketType: true },
                orderBy: { createdAt: "asc" },
            },
        },
    },
    links: { orderBy: { order: "asc" } },
};

// A diferencia de getMyEventsService, ACÁ no se filtra por archivedAt: esta
// función sirve tanto al wizard de edición como a la vista de sólo lectura
// del Historial (ver ArchivedEventBanner en el frontend) — el que decide
// qué mostrar es el caller, no este service. Sí corre el self-heal (acotado
// a este único evento) para que `archivedAt` esté al día si justo se
// cumplió la regla ahora.
export const getMyEventByIdService = async (clerkId, id, organizationId = null) => {
    const context = await getMyOrganization(clerkId, organizationId);
    if (!context) return null;

    await runArchiveSelfHeal(prisma, { eventId: id });

    const event = await prisma.event.findUnique({ where: { id }, include: EVENT_DETAIL_INCLUDE });
    if (!event || event.organizationId !== context.organization.id) return null;

    return event;
};

// FASE 3 (perf PREVIEW_DRAFT) — lectura final SIN re-validar pertenencia ni
// correr self-heal de archivado. Pensada EXCLUSIVAMENTE para
// EventServicePort.commit() en la rama DRAFT: para ese caller, el evento
// fue creado unas líneas antes EN LA MISMA llamada a commit() (nada
// concurrente puede haber tocado su organizationId en el medio, es
// secuencial dentro de una sola invocación async), así que re-verificar
// pertenencia sería repetir exactamente el mismo resultado que
// createEventService ya confirmó. El self-heal de archivado tampoco puede
// encontrar nada: un evento recién creado siempre está en status "DRAFT",
// que nunca matchea el filtro de runArchiveSelfHeal (sólo mira
// PUBLISHED/FINISHED/CANCELLED) — correrlo acá siempre sería una consulta
// que no puede cambiar el resultado. NO reemplaza a getMyEventByIdService
// para ningún otro caller (ej. event.controller.js/Web, que sí necesita
// volver a validar pertenencia y correr self-heal sobre un evento que pudo
// haber sido tocado por otro proceso desde la última vez que se leyó).
export const getEventWithDetailsById = (id) => {
    return prisma.event.findUnique({ where: { id }, include: EVENT_DETAIL_INCLUDE });
};

function assertPublishable(event) {
    if (!event.venueName || !event.venueName.trim()) {
        throw new Error("LOCATION_MISSING_VENUE_NAME");
    }
    if (!(event.formattedAddress?.trim() || event.addressLine?.trim())) {
        throw new Error("LOCATION_MISSING_ADDRESS");
    }
    // Las coordenadas (lat/lng) ya no son obligatorias para publicar: alcanza
    // con nombre de lugar + dirección en texto. Quedan como opcionales para
    // cuando el organizador las carga vía mapa (Google Maps / picker).

    if (!event.functions || event.functions.length === 0) {
        throw new Error("NO_FUNCTIONS");
    }
    if (!event.ticketTypes || event.ticketTypes.length === 0) {
        throw new Error("NO_TICKET_TYPES");
    }
    for (const tt of event.ticketTypes) {
        if (tt.price === null || tt.price === undefined) {
            throw new Error("TICKET_TYPE_WITHOUT_PRICE");
        }
        if (tt.quantity === null || tt.quantity === undefined) {
            throw new Error("TICKET_TYPE_WITHOUT_QUANTITY");
        }
    }
    for (const fn of event.functions) {
        const hasEnabledAssignment = (fn.ticketAssignments ?? []).some((a) => a.enabled);
        if (!hasEnabledAssignment) {
            throw new Error("FUNCTION_WITHOUT_TICKET_ASSIGNMENTS");
        }
    }
}

export const updateMyEventService = async (clerkId, id, input, organizationId = null) => {
    const context = await getMyOrganization(clerkId, organizationId);
    if (!context) return null;

    const event = await prisma.event.findUnique({ where: { id }, include: EVENT_DETAIL_INCLUDE });
    if (!event || event.organizationId !== context.organization.id) return null;

    // "No quiero editar directamente un evento archivado" — restaurarlo
    // primero (restoreEventService) es el único camino. Se chequea antes de
    // cualquier otra validación: no tiene sentido explicarle por qué falló
    // publicar/categorizar algo que ni siquiera se puede tocar.
    if (event.archivedAt) {
        throw new Error("EVENT_ARCHIVED");
    }

    assertValidCategory(input);

    const data = await buildEventData(input);

    if (Object.hasOwn(input, "status")) {
        if (input.status === "PUBLISHED") {
            if (!canPublishEvents(context.organization)) {
                throw new Error("ORGANIZATION_NOT_APPROVED");
            }
            assertPublishable(event);
        }

        data.status = input.status;
        if (input.status === "PUBLISHED" && !event.publishedAt) {
            data.publishedAt = new Date();
        }

        // cancelledAt: dedicado (nunca updatedAt) para la regla de archivado
        // "cancelado + 7 días" — ver eventArchive.service.js. Se limpia si
        // el estado vuelve a cambiar a otra cosa, para no dejar un
        // cancelledAt viejo mintiendo sobre un evento que ya no está
        // cancelado.
        if (input.status === "CANCELLED" && event.status !== "CANCELLED") {
            data.cancelledAt = new Date();
        } else if (input.status !== "CANCELLED" && event.status === "CANCELLED") {
            data.cancelledAt = null;
        }
    }

    if (Object.hasOwn(input, "visibility")) {
        data.visibility = input.visibility;
    }

    return prisma.event.update({ where: { id }, data, include: EVENT_DETAIL_INCLUDE });
};

function buildTicketTypeData(input) {
    return {
        name: input.name,
        price: input.price,
        quantity: input.quantity,
        maxPerPurchase: input.maxPerPurchase ?? 10,
        description: input.description || null,
        visible: input.visible ?? true,
    };
}

function buildFunctionData(input) {
    return {
        date: new Date(input.date),
        doorsOpenAt: input.doorsOpenAt ? new Date(input.doorsOpenAt) : null,
        endAt: input.endAt ? new Date(input.endAt) : null,
        venue: input.venue,
        address: input.address || null,
        capacity: input.capacity ? Number(input.capacity) : null,
        status: input.status || "SCHEDULED",
    };
}

// El "lugar base" (venue/address) del Event lo define el organizador en el paso
// de información general y no se sobrescribe automáticamente: cada función puede
// tener su propio lugar. Solo se derivan startDate (para ordenar/listar) e isFree.
function recomputeEventSummary(functionsInput, ticketTypesInput) {
    const scheduled = functionsInput
        .filter((fn) => fn.status !== "CANCELLED")
        .sort((a, b) => new Date(a.date) - new Date(b.date));

    const first = scheduled[0] ?? functionsInput[0] ?? null;
    const isFree =
        ticketTypesInput.length > 0 && ticketTypesInput.every((tt) => Number(tt.price) === 0);

    return {
        startDate: first?.date ? new Date(first.date) : null,
        isFree,
    };
}

// `returnEvent` (Fase 3O — perf): mismo criterio que syncEventLinksService
// de acá arriba — EventServicePort.commit nunca usa el evento que esta
// función devolvía, así que `{ returnEvent: false }` salta el findUnique
// final con EVENT_DETAIL_INCLUDE (el más caro de los dos: acá SÍ ya existen
// funciones/ticketTypes/asignaciones reales para incluir). Default `true`
// preserva el comportamiento exacto para event.controller.js (Web), que sí
// usa el evento devuelto.
export const syncEventScheduleService = async (clerkId, eventId, input, organizationId = null, { returnEvent = true } = {}) => {
    const context = await getMyOrganization(clerkId, organizationId);
    if (!context) return null;

    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event || event.organizationId !== context.organization.id) return null;

    const ticketTypesInput = Array.isArray(input?.ticketTypes) ? input.ticketTypes : [];
    const functionsInput = Array.isArray(input?.functions) ? input.functions : [];

    if (functionsInput.length === 0) {
        throw new Error("NO_FUNCTIONS");
    }
    if (ticketTypesInput.length === 0) {
        throw new Error("NO_TICKET_TYPES");
    }

    for (const fn of functionsInput) {
        if (!fn.date || !fn.venue) {
            throw new Error("FUNCTION_MISSING_FIELDS");
        }
    }
    for (const tt of ticketTypesInput) {
        if (!tt.name || tt.price === undefined || tt.price === null || !tt.quantity) {
            throw new Error("TICKET_TYPE_MISSING_FIELDS");
        }
    }

    // IDs generados acá (no delegados a @default(cuid()) de Prisma) para
    // poder insertar en batch con `createMany` y de todas formas saber de
    // antemano qué id le corresponde a cada fila — así se arman las
    // asignaciones función↔tipo de entrada sin esperar la respuesta de cada
    // INSERT uno por uno. Es sólo una clave primaria de tipo string; un
    // uuid es tan válido como el cuid que generaba Prisma antes.
    //
    // `createdAt` se fija a mano y escalonado (1ms por fila, en el mismo
    // orden en que ya se armaban antes) porque en un `createMany` todas las
    // filas se insertan en el mismo instante: sin esto, el `ORDER BY
    // createdAt` que ya usa EVENT_DETAIL_INCLUDE (y el resto de la app)
    // dejaría de ser estable entre lecturas. Mismos datos, mismo orden.
    const baseCreatedAt = Date.now();
    let tick = 0;
    const nextCreatedAt = () => new Date(baseCreatedAt + tick++);

    const ticketTypeRows = ticketTypesInput.map((tt) => ({
        id: randomUUID(),
        ...buildTicketTypeData(tt),
        eventId,
        createdAt: nextCreatedAt(),
    }));

    const functionRows = [];
    const assignmentRows = [];
    for (const fn of functionsInput) {
        const functionId = randomUUID();
        functionRows.push({ id: functionId, ...buildFunctionData(fn), eventId, createdAt: nextCreatedAt() });

        ticketTypeRows.forEach((ticketType, index) => {
            const assignment = fn.ticketAssignments?.[index] ?? {};
            assignmentRows.push({
                id: randomUUID(),
                functionId,
                ticketTypeId: ticketType.id,
                enabled: assignment.enabled ?? true,
                priceOverride:
                    assignment.priceOverride === undefined || assignment.priceOverride === null
                        ? null
                        : Number(assignment.priceOverride),
                quantityOverride:
                    assignment.quantityOverride === undefined || assignment.quantityOverride === null
                        ? null
                        : Number(assignment.quantityOverride),
                visibleOverride:
                    assignment.visibleOverride === undefined || assignment.visibleOverride === null
                        ? null
                        : Boolean(assignment.visibleOverride),
                createdAt: nextCreatedAt(),
            });
        });
    }

    await prisma.$transaction(async (tx) => {
        await tx.eventFunction.deleteMany({ where: { eventId } });
        await tx.ticketType.deleteMany({ where: { eventId } });

        if (ticketTypeRows.length > 0) {
            await tx.ticketType.createMany({ data: ticketTypeRows });
        }
        if (functionRows.length > 0) {
            await tx.eventFunction.createMany({ data: functionRows });
        }
        if (assignmentRows.length > 0) {
            await tx.functionTicketType.createMany({ data: assignmentRows });
        }

        const summary = recomputeEventSummary(functionsInput, ticketTypesInput);
        await tx.event.update({ where: { id: eventId }, data: summary });
    });

    if (!returnEvent) return null;
    return prisma.event.findUnique({ where: { id: eventId }, include: EVENT_DETAIL_INCLUDE });
};

// El organizador solo pega la URL: la plataforma (type/embedUrl/thumbnail/
// isEmbeddable) la determina siempre MediaParser acá, nunca lo que mande el
// cliente, para que quede consistente sin importar qué haya detectado el
// frontend mientras tipeaba.
function analyzeLink(link) {
    const url = link.url?.trim();
    if (!url) {
        throw new Error("LINK_MISSING_FIELDS");
    }
    if (!isValidHttpUrl(url)) {
        throw new Error("LINK_INVALID_URL");
    }

    const { platform, embedUrl, thumbnail, isEmbeddable } = parseMediaUrl(url);

    return {
        url,
        title: link.title?.trim() || null,
        type: platform,
        embedUrl,
        thumbnail,
        isEmbeddable,
    };
}

// `returnEvent` (Fase 3O — perf): EventServicePort.commit encadena esta
// llamada con syncEventScheduleService y una lectura final propia, y nunca
// usa el evento que esta función devolvía — lo pedía igual porque hasta acá
// no había forma de decirle "no lo necesito". Pasar `{ returnEvent: false }`
// salta ÚNICAMENTE el findUnique con EVENT_DETAIL_INCLUDE de más abajo (la
// sincronización de links en sí no cambia). Default `true` preserva EXACTO
// el comportamiento anterior para el único otro caller (event.controller.js,
// que sí usa el evento devuelto como respuesta HTTP).
export const syncEventLinksService = async (clerkId, eventId, linksInput, organizationId = null, { returnEvent = true } = {}) => {
    const context = await getMyOrganization(clerkId, organizationId);
    if (!context) return null;

    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event || event.organizationId !== context.organization.id) return null;

    const links = Array.isArray(linksInput) ? linksInput : [];
    const seenUrls = new Set();
    const analyzedLinks = [];

    for (const link of links) {
        const analyzed = analyzeLink(link);
        const normalizedUrl = analyzed.url.toLowerCase();
        if (seenUrls.has(normalizedUrl)) {
            throw new Error("LINK_DUPLICATE_URL");
        }
        seenUrls.add(normalizedUrl);
        analyzedLinks.push(analyzed);
    }

    await prisma.$transaction(async (tx) => {
        await tx.eventLink.deleteMany({ where: { eventId } });

        // Fase 3O — antes creaba cada link con un `create` propio dentro del
        // loop (N queries secuenciales, un N+1 real). EventLink no tiene
        // ninguna @@unique más allá de `id` (ver schema.prisma), y las URLs
        // ya se dedupean arriba en JS (LINK_DUPLICATE_URL) — un `createMany`
        // en una sola sentencia inserta exactamente las mismas filas, con el
        // mismo `order` por índice, sin riesgo de violar ninguna constraint
        // que el `create` uno-por-uno no corriera ya.
        if (analyzedLinks.length > 0) {
            await tx.eventLink.createMany({
                data: analyzedLinks.map((link, index) => ({ ...link, eventId, order: index })),
            });
        }
    });

    if (!returnEvent) return null;
    return prisma.event.findUnique({ where: { id: eventId }, include: EVENT_DETAIL_INCLUDE });
};

const PUBLIC_ORGANIZATION_SELECT = {
    select: { id: true, name: true, logo: true },
};

const SORTABLE_FIELDS = {
    recientes: { createdAt: "desc" },
    fecha: { startDate: "asc" },
    precio: [{ isFree: "desc" }, { startDate: "asc" }],
};

// Rangos de fecha para el filtro "cuando" del dropdown "Explorar eventos"
// (Hoy/Esta semana/Este mes/Próximamente). Devuelve un filtro de Prisma para
// `startDate` o `null` si `when` no es uno de esos valores.
function buildWhenFilter(when, now) {
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    if (when === "hoy") {
        const endOfToday = new Date(startOfToday);
        endOfToday.setDate(endOfToday.getDate() + 1);
        return { gte: startOfToday, lt: endOfToday };
    }

    if (when === "semana") {
        const endOfWeek = new Date(startOfToday);
        const daysUntilSunday = (7 - endOfWeek.getDay()) % 7 || 7;
        endOfWeek.setDate(endOfWeek.getDate() + daysUntilSunday);
        return { gte: startOfToday, lt: endOfWeek };
    }

    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    if (when === "mes") {
        return { gte: startOfToday, lt: endOfMonth };
    }

    if (when === "proximamente") {
        return { gte: endOfMonth };
    }

    return null;
}

export const getPublicEventsService = async ({ category, search, sort, when, price } = {}) => {
    const now = new Date();

    // Un evento publicado sin funciones futuras no debería aparecer en el
    // marketplace: se oculta todo lo que ya pasó de fecha.
    const conditions = [{ OR: [{ startDate: null }, { startDate: { gte: now } }] }];

    if (category && category !== "ALL") {
        conditions.push({ category });
    }

    if (search?.trim()) {
        const term = search.trim();
        conditions.push({
            OR: [
                { title: { contains: term, mode: "insensitive" } },
                { venue: { contains: term, mode: "insensitive" } },
                { organization: { name: { contains: term, mode: "insensitive" } } },
            ],
        });
    }

    const whenFilter = buildWhenFilter(when, now);
    if (whenFilter) {
        conditions.push({ startDate: whenFilter });
    }

    if (price === "gratis") {
        conditions.push({ isFree: true });
    }

    return prisma.event.findMany({
        where: { status: "PUBLISHED", visibility: "PUBLIC", AND: conditions },
        include: { organization: PUBLIC_ORGANIZATION_SELECT },
        orderBy: SORTABLE_FIELDS[sort] ?? SORTABLE_FIELDS.recientes,
    });
};

// Igual que EVENT_DETAIL_INCLUDE (organizador) pero acotado a lo que un
// comprador anónimo puede ver: sólo funciones vigentes (SCHEDULED) y sólo
// asignaciones habilitadas — nunca una entrada que ya no está a la venta.
// Necesario para el Wizard de compra (elegir función + tipos de entrada);
// antes este endpoint no traía nada de esto y el botón "Comprar entradas"
// de EventDetail.jsx quedaba armado con datos inexistentes.
const PUBLIC_EVENT_DETAIL_INCLUDE = {
    organization: PUBLIC_ORGANIZATION_SELECT,
    links: { orderBy: { order: "asc" } },
    ticketTypes: { orderBy: { createdAt: "asc" } },
    functions: {
        where: { status: "SCHEDULED" },
        orderBy: { date: "asc" },
        include: {
            ticketAssignments: {
                where: { enabled: true },
                include: { ticketType: true },
                orderBy: { createdAt: "asc" },
            },
        },
    },
};

// El Wizard de compra necesita el stock realmente disponible (no sólo el
// `quantity` configurado en el catálogo) para poder capar el selector de
// cantidad en min(stock disponible, maxPerPurchase) — mismo criterio de qué
// cuenta como "vendido" que getSoldCount en sale.service.js (ACTIVE/USED,
// nunca CANCELLED/REFUNDED). Se calcula al vuelo con una sola consulta
// agrupada por (ticketTypeId, functionId) para todas las funciones del
// evento, no una consulta por asignación.
async function attachTicketAvailability(event) {
    const functionIds = event.functions.map((fn) => fn.id);
    if (functionIds.length === 0) return event;

    const soldGroups = await prisma.ticket.groupBy({
        by: ["ticketTypeId", "functionId"],
        where: { functionId: { in: functionIds }, status: { in: SOLD_TICKET_STATUSES } },
        _count: { _all: true },
    });
    const soldByKey = new Map(soldGroups.map((g) => [`${g.ticketTypeId}:${g.functionId}`, g._count._all]));

    return {
        ...event,
        functions: event.functions.map((fn) => ({
            ...fn,
            ticketAssignments: fn.ticketAssignments.map((assignment) => {
                const capacity = effectiveCapacity(assignment);
                const sold = soldByKey.get(`${assignment.ticketTypeId}:${fn.id}`) ?? 0;
                return { ...assignment, available: Math.max(capacity - sold, 0) };
            }),
        })),
    };
}

export const getPublicEventBySlugService = async (slug) => {
    const event = await prisma.event.findUnique({
        where: { slug },
        include: PUBLIC_EVENT_DETAIL_INCLUDE,
    });

    if (!event || event.status !== "PUBLISHED" || event.visibility !== "PUBLIC") {
        return null;
    }

    return attachTicketAvailability(event);
};

// Sale.eventId y Ticket.eventId son ON DELETE RESTRICT a propósito (nunca
// CASCADE): ver sales_eventId_fkey/tickets_eventId_fkey en las migraciones.
// event_functions/ticket_types SÍ tienen CASCADE desde Event, pero a su vez
// están referenciadas por sales.functionId/tickets.functionId y
// sale_items.ticketTypeId/tickets.ticketTypeId — también RESTRICT — así que
// en la práctica, si el evento tiene una venta o un ticket, ninguna cascada
// llega a completarse y Postgres rechaza el DELETE (P2003). Se valida acá,
// antes, para que Prisma nunca llegue a intentarlo: un evento con ventas o
// entradas asociadas no se borra — hay que cancelarlo. EventScanner sí
// cascada limpio (nada más lo referencia), así que no hace falta chequearlo.
//
// Nunca se filtra por `deletedAt`: una venta o un ticket con soft-delete
// sigue siendo una fila real en la base y sigue bloqueando el DELETE igual
// que una activa — filtrar acá daría un falso "se puede borrar".
export const deleteMyEventService = async (clerkId, id) => {
    const context = await getMyOrganization(clerkId);
    if (!context) return false;

    const event = await prisma.event.findUnique({ where: { id } });
    if (!event || event.organizationId !== context.organization.id) return false;

    const [existingSale, existingTicket] = await Promise.all([
        prisma.sale.findFirst({ where: { eventId: id }, select: { id: true } }),
        prisma.ticket.findFirst({ where: { eventId: id }, select: { id: true } }),
    ]);
    if (existingSale || existingTicket) {
        throw new Error("EVENT_HAS_DEPENDENCIES");
    }

    await prisma.event.delete({ where: { id } });
    return true;
};

// Historial de Eventos — listado de archivados, con búsqueda opcional por
// título. No corre self-heal: ya están archivados, no hay nada que
// recalcular acá (el self-heal vive en los listados OPERATIVOS, que son
// los que necesitan detectar transiciones nuevas hacia el Historial).
export const listArchivedEventsService = async (clerkId, { search } = {}) => {
    const context = await getMyOrganization(clerkId);
    if (!context) return [];

    const where = { organizationId: context.organization.id, archivedAt: { not: null } };
    if (search?.trim()) {
        where.title = { contains: search.trim(), mode: "insensitive" };
    }

    return prisma.event.findMany({ where, orderBy: { archivedAt: "desc" } });
};

// Restaurar: vuelve a aparecer en el espacio operativo. Idempotente (si ya
// no estaba archivado, no rompe nada). No toca status/cancelledAt — un
// evento CANCELLED restaurado sigue CANCELLED, el organizador decide qué
// hacer con eso desde ahí; sólo dejó de estar en el Historial.
export const restoreEventService = async (clerkId, id) => {
    const context = await getMyOrganization(clerkId);
    if (!context) return null;

    const event = await prisma.event.findUnique({ where: { id } });
    if (!event || event.organizationId !== context.organization.id) return null;

    return prisma.event.update({ where: { id }, data: { archivedAt: null }, include: EVENT_DETAIL_INCLUDE });
};

// Duplicar — copia catálogo/descripción/ubicación/imagen (EventLink[],
// TicketType[]), NUNCA funciones (las fechas viejas no tienen sentido en
// una copia — el organizador arma la agenda nueva con syncEventScheduleService,
// sin tocarlo) ni nada transaccional (Sale/Ticket/CheckIn/ScanAttempt/
// TicketAuditLog/EventScanner — copiarlos sería peligroso, ej. duplicaría
// códigos QR "válidos"). Funciona igual sobre un evento archivado (sólo
// EDITARLO directo está bloqueado, ver updateMyEventService) — es
// justamente una de las dos acciones que ofrece el Historial. El nuevo
// evento nace siempre DRAFT.
export const duplicateEventService = async (clerkId, id) => {
    const context = await getMyOrganization(clerkId);
    if (!context) return null;

    const source = await prisma.event.findUnique({ where: { id }, include: EVENT_DETAIL_INCLUDE });
    if (!source || source.organizationId !== context.organization.id) return null;

    const newTitle = `${source.title} (copia)`;
    const slug = await generateUniqueSlug(newTitle, async (candidate) => {
        const existing = await prisma.event.findUnique({ where: { slug: candidate } });
        return Boolean(existing);
    });

    return prisma.$transaction(async (tx) => {
        const newEvent = await tx.event.create({
            data: {
                title: newTitle,
                slug,
                category: source.category,
                customCategory: source.customCategory,
                shortDescription: source.shortDescription,
                description: source.description,
                coverImage: source.coverImage,
                venue: source.venue,
                address: source.address,
                city: source.city,
                province: source.province,
                venueName: source.venueName,
                formattedAddress: source.formattedAddress,
                addressLine: source.addressLine,
                country: source.country,
                postalCode: source.postalCode,
                latitude: source.latitude,
                longitude: source.longitude,
                googlePlaceId: source.googlePlaceId,
                isFree: source.isFree,
                status: "DRAFT",
                organizationId: context.organization.id,
                createdBy: context.user.id,
            },
        });

        if (source.links.length > 0) {
            await tx.eventLink.createMany({
                data: source.links.map((link) => ({
                    eventId: newEvent.id,
                    type: link.type,
                    title: link.title,
                    url: link.url,
                    order: link.order,
                    embedUrl: link.embedUrl,
                    thumbnail: link.thumbnail,
                    isEmbeddable: link.isEmbeddable,
                })),
            });
        }

        if (source.ticketTypes.length > 0) {
            await tx.ticketType.createMany({
                data: source.ticketTypes.map((tt) => ({
                    eventId: newEvent.id,
                    name: tt.name,
                    price: tt.price,
                    quantity: tt.quantity,
                    maxPerPurchase: tt.maxPerPurchase,
                    description: tt.description,
                    visible: tt.visible,
                })),
            });
        }

        return tx.event.findUnique({ where: { id: newEvent.id }, include: EVENT_DETAIL_INCLUDE });
    });
};
