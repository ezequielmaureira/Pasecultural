import prisma from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { logger } from "../logging/logger.js";
import { sendDeveloperAlert, DeveloperAlertType } from "./email/sendDeveloperAlert.service.js";
import { generateUniqueSlug } from "../utils/generateSlug.js";
import { isFeatureAvailable, PremiumFeature } from "./organizationPlanPolicy.js";
import { hardDeleteOrganization } from "./organizationDeletion.service.js";

const ORGANIZATION_STATUSES = new Set([
    "PENDING",
    "APPROVED",
    "REJECTED",
    "SUSPENDED",
]);

async function getUserByClerkId(clerkId) {
    return prisma.user.findUnique({
        where: {
            clerkId,
        },
    });
}

// "Organización operativa actual" del propietario: nunca una cerrada por
// autoservicio (closedAt != null) — esa queda sólo como historial (Developer,
// ventas/tickets ya emitidos). Ver deleteMyOrganizationService.
export const getMyOrganizationService = async (clerkId) => {
    const user = await getUserByClerkId(clerkId);

    if (!user) return null;

    return prisma.organization.findFirst({
        where: {
            ownerId: user.id,
            closedAt: null,
        },
    });
};

export const createOrganizationService = async (
    clerkId,
    {
        name,
        type,
        organizationCategory,
        description,
        logo,
        phone,
        email,
        website,
        instagram,
        facebook,
        tiktok,
        province,
        city,
        cuit,
        responsibleFirstName,
        responsibleLastName,
        responsibleDni,
    }
) => {
    const user = await getUserByClerkId(clerkId);

    if (!user) {
        throw new Error("USER_NOT_SYNCED");
    }

    // Sólo una organización ACTIVA cuenta como "ya tenés una": quien cerró
    // la suya (closedAt != null) puede crear una nueva; la vieja queda como
    // historial.
    const existing = await prisma.organization.findFirst({
        where: {
            ownerId: user.id,
            closedAt: null,
        },
    });

    if (existing) {
        return { organization: existing, user };
    }

    // Premium — Fase 2A. Generado UNA vez acá, para TODA Organization
    // nueva sin importar el plan (default FREE) — mismo mecanismo
    // (generateUniqueSlug, utils/generateSlug.js) ya usado por
    // createEventService para Event.slug, sin reescribirlo. Igual que ahí:
    // el check-then-create no está envuelto en un retry explícito ante una
    // colisión de carrera — la constraint UNIQUE de la base
    // (Organization.slug) sigue siendo la última garantía real, mismo
    // criterio exacto que el ya establecido para Event.slug.
    const slug = await generateUniqueSlug(name, async (candidate) => {
        const existingSlug = await prisma.organization.findUnique({ where: { slug: candidate } });
        return Boolean(existingSlug);
    });

    const organization = await prisma.organization.create({
        data: {
            name,
            slug,
            type: type || null,
            organizationCategory: organizationCategory || null,
            description: description || null,
            logo: logo || null,
            phone: phone || null,
            email,
            website: website || null,
            instagram: instagram || null,
            facebook: facebook || null,
            tiktok: tiktok || null,
            province: province || null,
            city: city || null,
            cuit: cuit || null,
            responsibleFirstName: responsibleFirstName || null,
            responsibleLastName: responsibleLastName || null,
            responsibleDni: responsibleDni || null,
            status: "PENDING",
            ownerId: user.id,
        },
    });

    const updatedUser =
        user.role === "CUSTOMER"
            ? await prisma.user.update({
                  where: { id: user.id },
                  data: { role: "ORGANIZER" },
              })
            : user;

    // Alertas Developer — la organización acaba de entrar de verdad al
    // estado PENDING (nunca inventado: es el default real del modelo, ver
    // schema.prisma). Best-effort, nunca lanza — un fallo acá no puede
    // impedir que la organización quede creada. Sólo el camino que
    // realmente creó una fila NUEVA llega acá (el early-return de arriba,
    // "ya tenía una organización", nunca dispara esto).
    const alertResult = await sendDeveloperAlert(DeveloperAlertType.NEW_ORGANIZATION_PENDING, {
        organizationId: organization.id,
        name: organization.name,
        status: organization.status,
        createdAt: organization.createdAt,
    });
    if (!alertResult.sent) {
        logger.warn("createOrganizationService: no se pudo enviar la alerta Developer de nueva organización pendiente", {
            organizationId: organization.id,
            reason: alertResult.reason,
        });
    }

    // Verificación de teléfono/WhatsApp — flujo invertido: PaseCultural NO
    // inicia nada acá. El teléfono queda cargado y PENDIENTE
    // (phoneVerifiedAt null, default del modelo) hasta que el organizador
    // mismo, desde Configuración, toque "Verificar WhatsApp" (que genera un
    // deep link wa.me hacia el número oficial) y mande el CONFIRMAR real
    // capturado por el webhook de Meta — ver organizationPhoneVerification.service.js.

    return { organization, user: updatedUser };
};

// Verificación de teléfono/WhatsApp — "phone" DELIBERADAMENTE fuera de esta
// lista: a partir de este mecanismo, el ÚNICO camino para cambiar
// Organization.phone es organizationPhoneVerification.service.js (ver el
// informe de entrega, "UN SOLO mecanismo"). Si un PATCH viejo todavía
// manda `phone` en el body, Object.hasOwn ya no lo encuentra acá abajo y
// se ignora en silencio, exactamente igual que cualquier otro campo no
// reconocido.
const UPDATABLE_FIELDS = [
    "name",
    "type",
    "organizationCategory",
    "description",
    "logo",
    "email",
    "website",
    "instagram",
    "facebook",
    "tiktok",
    "province",
    "city",
    "cuit",
    "responsibleFirstName",
    "responsibleLastName",
    "responsibleDni",
];

export const updateMyOrganizationService = async (clerkId, input) => {
    const user = await getUserByClerkId(clerkId);

    if (!user) {
        throw new Error("USER_NOT_SYNCED");
    }

    const organization = await prisma.organization.findFirst({
        where: { ownerId: user.id, closedAt: null },
    });

    if (!organization) {
        return null;
    }

    const data = {};
    for (const field of UPDATABLE_FIELDS) {
        if (Object.hasOwn(input, field)) {
            data[field] = input[field] || null;
        }
    }

    return prisma.organization.update({
        where: { id: organization.id },
        data,
    });
};

export const SELF_SERVICE_DELETE_CONFIRMATION = "ELIMINAR";

// Autoservicio "Eliminar organización" (Configuración → Zona de peligro).
// Hard delete REAL con antecedente histórico (DeletedOrganization), todo en
// una sola transacción — ver organizationDeletion.service.js para qué se
// borra y qué se conserva. Se bloquea (ORGANIZATION_DELETE_BLOCKED) si
// quedan obligaciones vivas con compradores. El User se conserva (Clerk no
// se toca) y deja de ser ORGANIZER si ya no le queda ninguna organización:
// puede crear una nueva después.
export const deleteMyOrganizationService = async (clerkId, { confirmation } = {}, { now = new Date() } = {}) => {
    if (confirmation !== SELF_SERVICE_DELETE_CONFIRMATION) {
        throw new AppError(ErrorCodes.ORGANIZATION_DELETE_CONFIRMATION_REQUIRED);
    }

    const user = await getUserByClerkId(clerkId);

    if (!user) {
        throw new Error("USER_NOT_SYNCED");
    }

    const organization = await prisma.organization.findFirst({
        where: { ownerId: user.id, closedAt: null },
    });

    if (!organization) {
        return null;
    }

    const result = await prisma.$transaction(
        async (tx) => {
            const deletion = await hardDeleteOrganization(tx, organization, user, { reason: "DELETED_BY_USER", now });
            const remaining = await tx.organization.count({ where: { ownerId: user.id } });
            if (user.role === "ORGANIZER" && remaining === 0) {
                await tx.user.update({ where: { id: user.id }, data: { role: "CUSTOMER" } });
            }
            return deletion;
        },
        { timeout: 30_000 }
    );

    logger.info("deleteMyOrganizationService: organización eliminada por su propietario", {
        organizationId: organization.id,
        deletedOrganizationId: result.deletedOrganization.id,
        deletedEvents: result.deletedEventIds.length,
        archivedEvents: result.archivedEventIds.length,
    });
    return { mode: "deleted", deletedAt: result.deletedOrganization.deletedAt };
};

// Usado exclusivamente por Developer → Organizaciones (organization.controller.js,
// las rutas requireRole("DEVELOPER") de organization.routes.js). El owner
// completo (antes `include: { owner: true }`) traía también clerkId y el
// resto de la fila de User sin que ningún consumidor lo usara —
// DeveloperOrganizations.jsx/OrganizationDetailModal.jsx sólo leen
// owner.firstName/lastName/email (verificado contra el código real de
// ambos). `organization.owner.firstName/lastName/email` sigue funcionando
// exactamente igual.
const DEVELOPER_ORGANIZATION_OWNER_SELECT = {
    owner: { select: { id: true, firstName: true, lastName: true, email: true } },
};

// Estado sintético de las filas históricas (DeletedOrganization). NO es un
// valor de OrganizationStatus: nunca se persiste ni se acepta en
// PATCH /:id/status — sólo lo lee el panel Developer para la etiqueta.
export const DELETED_BY_USER_STATUS = "DELETED_BY_USER";

// Misma forma que una Organization del listado (lo que leen
// DeveloperOrganizations.jsx/OrganizationDetailModal.jsx) + `deleted: true`.
// `id` es el del antecedente: cualquier PATCH/DELETE con ese id responde
// 404 porque no existe en Organization.
export function toDeletedOrganizationRow(deleted) {
    return {
        id: deleted.id,
        deleted: true,
        originalOrganizationId: deleted.originalOrganizationId,
        status: DELETED_BY_USER_STATUS,
        deletionReason: deleted.reason,
        name: deleted.name,
        logo: deleted.logo,
        email: deleted.email,
        plan: deleted.plan,
        type: deleted.type,
        city: deleted.city,
        province: deleted.province,
        responsibleFirstName: deleted.responsibleFirstName,
        responsibleLastName: deleted.responsibleLastName,
        createdAt: deleted.originalCreatedAt,
        approvedAt: deleted.approvedAt,
        deletedAt: deleted.deletedAt,
        owner: {
            id: deleted.ownerId,
            firstName: deleted.ownerFirstName,
            lastName: deleted.ownerLastName,
            email: deleted.ownerEmail,
        },
    };
}

// Con un filtro de estado (Pendientes/Aprobadas/Rechazadas/Suspendidas)
// sólo se listan Organizations reales. Sin filtro ("Todas") se suman los
// antecedentes de organizaciones eliminadas por su propietario, ordenados
// por fecha de registro original junto con el resto.
export const getOrganizationsService = async (status) => {
    if (status && ORGANIZATION_STATUSES.has(status)) {
        return prisma.organization.findMany({
            where: { status },
            include: DEVELOPER_ORGANIZATION_OWNER_SELECT,
            orderBy: { createdAt: "desc" },
        });
    }

    const [organizations, deletedOrganizations] = await Promise.all([
        prisma.organization.findMany({
            include: DEVELOPER_ORGANIZATION_OWNER_SELECT,
            orderBy: { createdAt: "desc" },
        }),
        prisma.deletedOrganization.findMany({ orderBy: { originalCreatedAt: "desc" } }),
    ]);

    return [...organizations, ...deletedOrganizations.map(toDeletedOrganizationRow)].sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );
};

export const getOrganizationByIdService = async (id) => {
    return prisma.organization.findUnique({
        where: { id },
        include: DEVELOPER_ORGANIZATION_OWNER_SELECT,
    });
};

export const updateOrganizationStatusService = async (
    id,
    status,
    approvedById
) => {
    const organization = await prisma.organization.findUnique({
        where: { id },
    });

    // Cerrada por su propietario con el mecanismo viejo (closedAt): ya no
    // es una organización operable — mismo 404 que una inexistente, hasta
    // que scripts/convertClosedOrganizations.js la convierta.
    if (!organization || organization.closedAt) return null;

    const data = { status };

    if (status === "APPROVED") {
        data.approvedAt = new Date();
        data.approvedBy = approvedById;
    }

    return prisma.organization.update({
        where: { id },
        data,
    });
};

// Premium — Fase 1, mismo patrón exacto que updateOrganizationStatusService
// de acá arriba: sólo DEVELOPER llega a llamar esto (ver requireRole en
// organization.routes.js). Actualiza EXCLUSIVAMENTE plan/planUpdatedAt/
// planUpdatedByUserId — nunca toca status/approvedAt/approvedBy/ownerId ni
// ningún otro dato comercial de la Organization. `plan` ya viene validado
// por el controller (FREE/PREMIUM) antes de llegar acá, mismo criterio que
// `status` en updateOrganizationStatusService.
export const updateOrganizationPlanService = async (
    id,
    plan,
    developerUserId
) => {
    const organization = await prisma.organization.findUnique({
        where: { id },
    });

    // Cerrada por su propietario con el mecanismo viejo (closedAt): ya no
    // es una organización operable — mismo 404 que una inexistente, hasta
    // que scripts/convertClosedOrganizations.js la convierta.
    if (!organization || organization.closedAt) return null;

    return prisma.organization.update({
        where: { id },
        data: {
            plan,
            planUpdatedAt: new Date(),
            planUpdatedByUserId: developerUserId,
        },
    });
};

// Rubro real de contenido — mismo patrón exacto que
// updateOrganizationPlanService de acá arriba: sólo DEVELOPER llega a
// llamar esto (ver requireRole en organization.routes.js). Actualiza
// EXCLUSIVAMENTE organizationCategory — nunca toca plan/status/ownerId ni
// ningún otro dato comercial de la Organization. `category` ya viene
// validada por el controller (uno de OrganizationCategory, o null para
// "sin categoría") antes de llegar acá.
export const updateOrganizationCategoryService = async (id, category) => {
    const organization = await prisma.organization.findUnique({
        where: { id },
    });

    // Cerrada por su propietario con el mecanismo viejo (closedAt): ya no
    // es una organización operable — mismo 404 que una inexistente, hasta
    // que scripts/convertClosedOrganizations.js la convierta.
    if (!organization || organization.closedAt) return null;

    return prisma.organization.update({
        where: { id },
        data: { organizationCategory: category },
    });
};

// Developer > Organizaciones → Eliminar. Borrado físico "a secas": sólo
// prospera si la organización no tiene nada colgando (las FK hacia
// Organization son RESTRICT). Si las tiene, error controlado 409 en vez de
// un 500 — nunca desacopla ni borra eventos/ventas por su cuenta.
// Con FK declaradas RESTRICT, Postgres responde 23001 (restrict_violation) y
// Prisma lo entrega como PrismaClientUnknownRequestError SIN `code` — por
// eso además de P2003/P2014 se reconoce el SQLSTATE en el mensaje.
const FOREIGN_KEY_VIOLATION_CODES = new Set(["P2003", "P2014"]);
const FOREIGN_KEY_VIOLATION_MESSAGE = /\b(23001|23503)\b|violates (RESTRICT setting of )?foreign key constraint/i;

function isForeignKeyViolation(error) {
    return FOREIGN_KEY_VIOLATION_CODES.has(error?.code) || FOREIGN_KEY_VIOLATION_MESSAGE.test(String(error?.message ?? ""));
}

export const deleteOrganizationService = async (id) => {
    try {
        await prisma.organization.delete({ where: { id } });
    } catch (error) {
        if (isForeignKeyViolation(error)) {
            throw new AppError(ErrorCodes.ORGANIZATION_HAS_RELATED_DATA, { cause: error });
        }
        throw error;
    }
};

// Premium — Fase 2D. Selección SIEMPRE por slug (findUnique), nunca por
// ownerId/findFirst — evita cualquier ambigüedad de qué Organization es "la"
// del owner. `plan` se selecciona acá SOLO para evaluar isFeatureAvailable
// más abajo — nunca se incluye en el objeto `organization` devuelto al
// caller. Mismo código de error (ORGANIZATION_PUBLIC_PAGE_NOT_AVAILABLE)
// para slug inexistente y para Organization no-PREMIUM: la respuesta pública
// nunca puede distinguir "no existe" de "existe pero es FREE".
// Fast Organization Public Experience — `includeEvents` (default true,
// mismo contrato legacy exacto) es ADITIVO: `includeEvents: false` es lo que
// usa el nuevo flujo paralelo de OrganizationProfile.jsx (que ya trae sus
// propios eventos de GET /api/events/public?organizationSlug=..., resuelto
// en un único event.findMany — ver getPublicEventsService). Con
// `includeEvents: false` esta función NUNCA ejecuta su propio
// event.findMany: sólo resuelve identidad/autorización (organization.findUnique
// + isFeatureAvailable en memoria), evitando la tercera query/segunda
// consulta de eventos que existía antes. Único consumidor real verificado de
// este service es getPublicOrganizationBySlug (organization.controller.js) —
// se preserva igual el default `true` por si algún otro caller futuro llega
// a depender del contrato completo de siempre.
export const getPublicOrganizationBySlugService = async (slug, { includeEvents = true } = {}) => {
    if (!slug) {
        throw new Error("ORGANIZATION_PUBLIC_PAGE_NOT_AVAILABLE");
    }

    // Sólo una organización APPROVED y no cerrada tiene página pública —
    // mismo error que "no existe" (la respuesta nunca distingue el motivo).
    const organization = await prisma.organization.findFirst({
        where: { slug, status: "APPROVED", closedAt: null },
        select: {
            id: true,
            name: true,
            slug: true,
            description: true,
            city: true,
            province: true,
            website: true,
            instagram: true,
            facebook: true,
            tiktok: true,
            logo: true,
            plan: true,
        },
    });

    if (!organization || !(await isFeatureAvailable(organization, PremiumFeature.PUBLIC_ORGANIZATION_PAGE))) {
        throw new Error("ORGANIZATION_PUBLIC_PAGE_NOT_AVAILABLE");
    }

    const publicOrganization = {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        logo: organization.logo,
        description: organization.description,
        city: organization.city,
        province: organization.province,
        website: organization.website,
        instagram: organization.instagram,
        facebook: organization.facebook,
        tiktok: organization.tiktok,
        plan: organization.plan,
    };

    if (!includeEvents) {
        return { organization: publicOrganization };
    }

    // Predicado replicado del listado público real (getPublicEventsService,
    // event.service.js): status PUBLISHED + visibility PUBLIC + (sin fecha
    // de inicio O fecha de inicio todavía no pasada). Duplicado acá a
    // propósito — extraerlo a un helper compartido tocaría event.service.js
    // fuera del alcance de esta fase; NO se está definiendo una segunda
    // semántica de "evento público", es la misma exacta. archivedAt NO se
    // filtra acá, a propósito: /eventos tampoco lo filtra hoy y esta fase no
    // corrige eso (fix transversal separado, fuera de alcance).
    const now = new Date();
    const events = await prisma.event.findMany({
        where: {
            organizationId: organization.id,
            status: "PUBLISHED",
            visibility: "PUBLIC",
            OR: [{ startDate: null }, { startDate: { gte: now } }],
        },
        orderBy: { startDate: "asc" },
    });

    return {
        organization: publicOrganization,
        events: events.map((event) => ({
            ...event,
            organization: { id: organization.id, name: organization.name },
        })),
    };
};
