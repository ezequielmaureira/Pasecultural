import prisma from "../config/prisma.js";

// "Organizaciones Destacadas" — ranking 100% automático y calculado, sin
// ningún flag manual (ni siquiera OrganizationPlanLimits.featuredEligible,
// que existe en el schema como un toggle CONFIGURABLE POR PLAN pensado
// para habilitar/deshabilitar la feature entera desde Developer > Planes,
// no para elegir a mano qué Organization puntual aparece — ver el informe
// de entrega para el detalle de por qué NO se usa acá como gate de
// elegibilidad: la regla de negocio pedida es "sólo PREMIUM, siempre",
// nunca condicionada a un booleano que hoy nace en `false` para ambos
// planes). Elegibilidad = Organization.plan === "PREMIUM" Y
// Organization.status === "APPROVED" (Organization no tiene `deletedAt`;
// APPROVED es el equivalente real de "no eliminada / vigente" que sí
// existe en el schema — PENDING/REJECTED/SUSPENDED nunca son públicas).
//
// Fórmula (fija, no configurable):
//   ticketScore = ticketsSold / maxTicketsSold (entre elegibles; 0 si max=0)
//   eventScore  = completedEvents / maxCompletedEvents (0 si max=0)
//   finalScore  = ticketScore*0.70 + eventScore*0.30
//
// Desempate determinista: mayor ticketsSold, luego mayor completedEvents,
// luego nombre ascendente (localeCompare) — nunca random, nunca por id.

const now_ = () => new Date();

// Ventas "confirmadas" = Ticket con status ACTIVE o USED (no CANCELLED, no
// REFUNDED), sin soft-delete (deletedAt null), origin SALE (una cortesía
// gratuita — origin COURTESY — no es una "entrada vendida"). Se cuenta por
// Ticket y no por Sale.status porque Ticket.status es el estado vigente
// real de cada entrada individual: una Sale puede quedar CONFIRMED en el
// registro histórico aunque después se cancele/reembolse un ticket puntual
// de esa venta (ver TicketStatus en schema.prisma) — contar por Sale.status
// sobre-contaría esos casos.
const VALID_TICKET_STATUSES = ["ACTIVE", "USED"];

// Evento "realizado" = Event.status IN (PUBLISHED, FINISHED) — es decir,
// nunca DRAFT (todavía no es público, aunque tenga una función con fecha
// pasada cargada) y nunca CANCELLED. Confirmado contra event.service.js:
// en la práctica hoy sólo se escriben DRAFT/PUBLISHED/CANCELLED (SCHEDULED/
// FINISHED de EventStatus no se usan todavía), y PUBLISHED es el estado que
// el resto del código trata como "evento público" (getPublicEvents usa
// status: "PUBLISHED", visibility: "PUBLIC"). Se incluye también FINISHED
// por completitud del enum si en el futuro se empieza a escribir. Además
// debe tener al menos una EventFunction con status !== CANCELLED y
// date < ahora. Se cuenta UNA sola vez por evento (distinct eventId) aunque
// tenga varias funciones pasadas.
const REALIZADO_EVENT_STATUSES = ["PUBLISHED", "FINISHED"];

async function computeOrgScores(eligibleOrgs) {
    const orgIds = eligibleOrgs.map((o) => o.id);
    if (orgIds.length === 0) return [];

    const now = now_();

    // Una sola query trae TODOS los eventos de TODAS las orgs elegibles —
    // evita cualquier loop de queries por organización (N+1). A partir de
    // acá todo el cálculo es en memoria sobre estos pocos miles de filas
    // como mucho.
    const events = await prisma.event.findMany({
        where: { organizationId: { in: orgIds } },
        select: { id: true, organizationId: true, status: true },
    });
    const eventIdToOrgId = new Map(events.map((e) => [e.id, e.organizationId]));
    const realizableEventIds = events
        .filter((e) => REALIZADO_EVENT_STATUSES.includes(e.status))
        .map((e) => e.id);
    const allEventIds = events.map((e) => e.id);

    // Entradas vendidas por evento (agrupado, una sola query) — luego se
    // suma por organización en memoria vía eventIdToOrgId.
    const ticketGroups = allEventIds.length
        ? await prisma.ticket.groupBy({
              by: ["eventId"],
              where: {
                  eventId: { in: allEventIds },
                  status: { in: VALID_TICKET_STATUSES },
                  deletedAt: null,
                  origin: "SALE",
              },
              _count: { _all: true },
          })
        : [];

    // Funciones ya realizadas (fecha pasada, ni la función ni el evento
    // cancelados), distinct por evento — una sola query.
    const completedFunctionRows = realizableEventIds.length
        ? await prisma.eventFunction.findMany({
              where: {
                  eventId: { in: realizableEventIds },
                  date: { lt: now },
                  status: { not: "CANCELLED" },
              },
              select: { eventId: true },
              distinct: ["eventId"],
          })
        : [];

    const ticketsSoldByOrg = new Map(orgIds.map((id) => [id, 0]));
    for (const group of ticketGroups) {
        const orgId = eventIdToOrgId.get(group.eventId);
        if (!orgId) continue;
        ticketsSoldByOrg.set(orgId, (ticketsSoldByOrg.get(orgId) ?? 0) + group._count._all);
    }

    const completedEventsByOrg = new Map(orgIds.map((id) => [id, 0]));
    for (const row of completedFunctionRows) {
        const orgId = eventIdToOrgId.get(row.eventId);
        if (!orgId) continue;
        completedEventsByOrg.set(orgId, (completedEventsByOrg.get(orgId) ?? 0) + 1);
    }

    const maxTicketsSold = Math.max(0, ...[...ticketsSoldByOrg.values()]);
    const maxCompletedEvents = Math.max(0, ...[...completedEventsByOrg.values()]);

    const scored = eligibleOrgs.map((org) => {
        const ticketsSold = ticketsSoldByOrg.get(org.id) ?? 0;
        const completedEvents = completedEventsByOrg.get(org.id) ?? 0;
        const ticketScore = maxTicketsSold > 0 ? ticketsSold / maxTicketsSold : 0;
        const eventScore = maxCompletedEvents > 0 ? completedEvents / maxCompletedEvents : 0;
        const finalScore = ticketScore * 0.7 + eventScore * 0.3;
        return { ...org, ticketsSold, completedEvents, finalScore };
    });

    scored.sort((a, b) => {
        if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
        if (b.ticketsSold !== a.ticketsSold) return b.ticketsSold - a.ticketsSold;
        if (b.completedEvents !== a.completedEvents) return b.completedEvents - a.completedEvents;
        return a.name.localeCompare(b.name, "es", { sensitivity: "base" });
    });

    return scored;
}

function toPublicShape(org) {
    // El score/fórmula NUNCA se expone al público — sólo lo que la UI
    // necesita para mostrar la card.
    return {
        id: org.id,
        name: org.name,
        slug: org.slug,
        logo: org.logo,
        city: org.city,
        province: org.province,
        type: org.type,
        organizationCategory: org.organizationCategory ?? null,
    };
}

const VALID_ORGANIZATION_CATEGORIES = new Set([
    "THEATER",
    "CINEMA",
    "MUSIC",
    "SPORTS",
    "CULTURE",
    "PRODUCER",
    "OTHER",
]);

// Valor sentinela de filtro para "Sin categoría" (organizationCategory
// NULL) — no es un valor real del enum OrganizationCategory, así que no
// puede colisionar con uno.
const UNCATEGORIZED_FILTER_VALUE = "UNCATEGORIZED";

// GET /api/organizations/public/featured?limit=10 — top N para la fila de
// Home. Además de ser PREMIUM+APPROVED, para esta fila puntual (no para
// /organizaciones) se exige nombre Y logo — una card sin logo no tiene
// nada que mostrar en un shelf de logos/cards, así que se excluye acá
// (sigue elegible y visible en el listado completo /organizaciones).
export async function getFeaturedOrganizationsService(limit = 10) {
    const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 50) : 10;

    const eligibleOrgs = await prisma.organization.findMany({
        where: { plan: "PREMIUM", status: "APPROVED" },
        select: {
            id: true,
            name: true,
            slug: true,
            logo: true,
            city: true,
            province: true,
            type: true,
            organizationCategory: true,
        },
    });

    const withLogo = eligibleOrgs.filter((o) => Boolean(o.name) && Boolean(o.logo));
    const scored = await computeOrgScores(withLogo);

    return { organizations: scored.slice(0, safeLimit).map(toPublicShape) };
}

// GET /api/organizations/public?search=&category=&page=&limit= — listado
// completo paginado, ordenado por score desc. `category` filtra server-side
// por Organization.organizationCategory vía Prisma `where` — nunca se trae
// todo a memoria para filtrar en frontend. Acepta uno de los valores reales
// de OrganizationCategory (THEATER/CINEMA/MUSIC/SPORTS/CULTURE/PRODUCER/
// OTHER) o el sentinela "UNCATEGORIZED" para pedir explícitamente las
// organizaciones sin rubro cargado (organizationCategory NULL) — esa es la
// UX elegida para "Sin categoría" en el selector público: un organizationCategory
// null NUNCA se excluye del listado general (sin filtro de category), sólo
// se filtra puntualmente cuando el usuario elige esa opción. Un valor de
// `category` que no matchea ninguna opción real se ignora (se trata como
// "todos los rubros") en vez de devolver 400 — mismo criterio permisivo que
// ya tenía `search`.
export async function getPublicOrganizationsListService({ search = "", category = "", page = 1, limit = 20 } = {}) {
    const safePage = Number.isInteger(Number(page)) && Number(page) > 0 ? Number(page) : 1;
    const safeLimit = Number.isInteger(Number(limit)) && Number(limit) > 0 ? Math.min(Number(limit), 50) : 20;
    const term = typeof search === "string" ? search.trim() : "";
    const categoryFilter = typeof category === "string" ? category.trim() : "";

    let categoryWhere = {};
    if (categoryFilter === UNCATEGORIZED_FILTER_VALUE) {
        categoryWhere = { organizationCategory: null };
    } else if (VALID_ORGANIZATION_CATEGORIES.has(categoryFilter)) {
        categoryWhere = { organizationCategory: categoryFilter };
    }

    const where = {
        plan: "PREMIUM",
        status: "APPROVED",
        ...(term ? { name: { contains: term, mode: "insensitive" } } : {}),
        ...categoryWhere,
    };

    const eligibleOrgs = await prisma.organization.findMany({
        where,
        select: {
            id: true,
            name: true,
            slug: true,
            logo: true,
            city: true,
            province: true,
            type: true,
            organizationCategory: true,
        },
    });

    const scored = await computeOrgScores(eligibleOrgs);

    const total = scored.length;
    const start = (safePage - 1) * safeLimit;
    const pageItems = scored.slice(start, start + safeLimit).map(toPublicShape);

    return {
        organizations: pageItems,
        pagination: {
            page: safePage,
            limit: safeLimit,
            total,
            totalPages: Math.max(1, Math.ceil(total / safeLimit)),
        },
        // category recibida pero sin efecto — no hay campo real todavía.
        category: category || null,
    };
}
