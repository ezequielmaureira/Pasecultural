import prisma from "../config/prisma.js";
import { generateUniqueSlug } from "../utils/generateSlug.js";
import { canPublishEvents } from "../utils/organizationTrust.js";
import { isValidHttpUrl, parseMediaUrl } from "../utils/mediaParser.js";

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

async function getMyOrganization(clerkId) {
    const user = await getUserByClerkId(clerkId);
    if (!user) return null;

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
// `location` recibido del LocationPicker. Además sincroniza los campos
// legacy (venue/address/city/province) para no romper el marketplace
// público, que todavía lee esos campos denormalizados.
function buildLocationData(location) {
    if (!location || typeof location !== "object") return {};

    assertValidCoordinate(location.latitude, -90, 90, "INVALID_LATITUDE");
    assertValidCoordinate(location.longitude, -180, 180, "INVALID_LONGITUDE");

    const venueName = location.venueName?.trim() || null;
    const formattedAddress = location.formattedAddress?.trim() || null;
    const addressLine = location.addressLine?.trim() || null;
    const city = location.city?.trim() || null;
    const province = location.province?.trim() || null;

    return {
        venueName,
        formattedAddress,
        addressLine,
        city,
        province,
        country: location.country?.trim() || null,
        postalCode: location.postalCode?.trim() || null,
        latitude:
            location.latitude === null || location.latitude === undefined || location.latitude === ""
                ? null
                : Number(location.latitude),
        longitude:
            location.longitude === null ||
            location.longitude === undefined ||
            location.longitude === ""
                ? null
                : Number(location.longitude),
        googlePlaceId: location.googlePlaceId?.trim() || null,
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

function buildEventData(input) {
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
        Object.assign(data, buildLocationData(input.location));
    }

    return data;
}

export const createEventService = async (clerkId, input) => {
    const context = await getMyOrganization(clerkId);
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

    const data = buildEventData(input);

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

export const getMyEventsService = async (clerkId) => {
    const context = await getMyOrganization(clerkId);
    if (!context) return [];

    return prisma.event.findMany({
        where: { organizationId: context.organization.id },
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

export const getMyEventByIdService = async (clerkId, id) => {
    const context = await getMyOrganization(clerkId);
    if (!context) return null;

    const event = await prisma.event.findUnique({ where: { id }, include: EVENT_DETAIL_INCLUDE });
    if (!event || event.organizationId !== context.organization.id) return null;

    return event;
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

export const updateMyEventService = async (clerkId, id, input) => {
    const context = await getMyOrganization(clerkId);
    if (!context) return null;

    const event = await prisma.event.findUnique({ where: { id }, include: EVENT_DETAIL_INCLUDE });
    if (!event || event.organizationId !== context.organization.id) return null;

    assertValidCategory(input);

    const data = buildEventData(input);

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

export const syncEventScheduleService = async (clerkId, eventId, input) => {
    const context = await getMyOrganization(clerkId);
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

    await prisma.$transaction(async (tx) => {
        await tx.eventFunction.deleteMany({ where: { eventId } });
        await tx.ticketType.deleteMany({ where: { eventId } });

        const createdTicketTypes = [];
        for (const tt of ticketTypesInput) {
            const created = await tx.ticketType.create({
                data: { ...buildTicketTypeData(tt), eventId },
            });
            createdTicketTypes.push(created);
        }

        for (const fn of functionsInput) {
            await tx.eventFunction.create({
                data: {
                    ...buildFunctionData(fn),
                    eventId,
                    ticketAssignments: {
                        create: createdTicketTypes.map((ticketType, index) => {
                            const assignment = fn.ticketAssignments?.[index] ?? {};
                            return {
                                ticketTypeId: ticketType.id,
                                enabled: assignment.enabled ?? true,
                                priceOverride:
                                    assignment.priceOverride === undefined ||
                                    assignment.priceOverride === null
                                        ? null
                                        : Number(assignment.priceOverride),
                                quantityOverride:
                                    assignment.quantityOverride === undefined ||
                                    assignment.quantityOverride === null
                                        ? null
                                        : Number(assignment.quantityOverride),
                                visibleOverride:
                                    assignment.visibleOverride === undefined ||
                                    assignment.visibleOverride === null
                                        ? null
                                        : Boolean(assignment.visibleOverride),
                            };
                        }),
                    },
                },
            });
        }

        const summary = recomputeEventSummary(functionsInput, ticketTypesInput);
        await tx.event.update({ where: { id: eventId }, data: summary });
    });

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

export const syncEventLinksService = async (clerkId, eventId, linksInput) => {
    const context = await getMyOrganization(clerkId);
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

        for (let index = 0; index < analyzedLinks.length; index += 1) {
            await tx.eventLink.create({
                data: { ...analyzedLinks[index], eventId, order: index },
            });
        }
    });

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

export const getPublicEventBySlugService = async (slug) => {
    const event = await prisma.event.findUnique({
        where: { slug },
        include: {
            organization: PUBLIC_ORGANIZATION_SELECT,
            links: { orderBy: { order: "asc" } },
        },
    });

    if (!event || event.status !== "PUBLISHED" || event.visibility !== "PUBLIC") {
        return null;
    }

    return event;
};

export const deleteMyEventService = async (clerkId, id) => {
    const context = await getMyOrganization(clerkId);
    if (!context) return false;

    const event = await prisma.event.findUnique({ where: { id } });
    if (!event || event.organizationId !== context.organization.id) return false;

    await prisma.event.delete({ where: { id } });
    return true;
};
