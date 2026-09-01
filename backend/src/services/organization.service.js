import prisma from "../config/prisma.js";
import { logger } from "../logging/logger.js";
import { sendDeveloperAlert, DeveloperAlertType } from "./email/sendDeveloperAlert.service.js";
import { generateUniqueSlug } from "../utils/generateSlug.js";
import { isFeatureAvailable, PremiumFeature } from "./organizationPlanPolicy.js";
import { isValidHexColor } from "../utils/colorValidation.js";

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

// Organization Theme (dashboard) — Premium Fase 2D.1. Cambio ADITIVO: se
// mantiene devolviendo el registro completo (plan, logo, brandPrimaryColor,
// etc. — consumido tal cual por OrganizerSettings/OrganizationBrandingCard/
// functionCapacity.service/organizerNotificationSettings.service, que sólo
// leen campos puntuales o `.id`). Se agrega `branding.enabled`, la ÚNICA
// autoridad server-side de CUSTOM_BRANDING para el panel privado del propio
// dueño — resuelta con la misma policy que ya usa el path público
// (getPublicOrganizationBySlugService), nunca con `plan === "PREMIUM"`
// hardcodeado en otro lado. El frontend (OrganizationThemeContext) consume
// `organization.branding.enabled`, nunca `organization.plan`, para decidir
// si el Organization Theme se activa.
export const getMyOrganizationService = async (clerkId) => {
    const user = await getUserByClerkId(clerkId);

    if (!user) return null;

    const organization = await prisma.organization.findFirst({
        where: {
            ownerId: user.id,
        },
    });
    if (!organization) return null;

    return {
        ...organization,
        branding: { enabled: isFeatureAvailable(organization, PremiumFeature.CUSTOM_BRANDING) },
    };
};

export const createOrganizationService = async (
    clerkId,
    {
        name,
        type,
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

    const existing = await prisma.organization.findFirst({
        where: {
            ownerId: user.id,
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
        where: { ownerId: user.id },
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

export const deleteMyOrganizationService = async (clerkId) => {
    const user = await getUserByClerkId(clerkId);

    if (!user) {
        throw new Error("USER_NOT_SYNCED");
    }

    const organization = await prisma.organization.findFirst({
        where: { ownerId: user.id },
    });

    if (!organization) {
        return false;
    }

    await prisma.organization.delete({ where: { id: organization.id } });
    return true;
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

export const getOrganizationsService = async (status) => {
    const where =
        status && ORGANIZATION_STATUSES.has(status) ? { status } : {};

    return prisma.organization.findMany({
        where,
        include: DEVELOPER_ORGANIZATION_OWNER_SELECT,
        orderBy: { createdAt: "desc" },
    });
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

    if (!organization) return null;

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

    if (!organization) return null;

    return prisma.organization.update({
        where: { id },
        data: {
            plan,
            planUpdatedAt: new Date(),
            planUpdatedByUserId: developerUserId,
        },
    });
};

export const deleteOrganizationService = async (id) => {
    await prisma.organization.delete({ where: { id } });
};

// Premium — Fase 2D. Selección SIEMPRE por slug (findUnique), nunca por
// ownerId/findFirst — evita cualquier ambigüedad de qué Organization es "la"
// del owner. `plan` se selecciona acá SOLO para evaluar isFeatureAvailable
// más abajo — nunca se incluye en el objeto `organization` devuelto al
// caller. Mismo código de error (ORGANIZATION_PUBLIC_PAGE_NOT_AVAILABLE)
// para slug inexistente y para Organization no-PREMIUM: la respuesta pública
// nunca puede distinguir "no existe" de "existe pero es FREE".
export const getPublicOrganizationBySlugService = async (slug) => {
    if (!slug) {
        throw new Error("ORGANIZATION_PUBLIC_PAGE_NOT_AVAILABLE");
    }

    const organization = await prisma.organization.findUnique({
        where: { slug },
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
            brandPrimaryColor: true,
            brandSecondaryColor: true,
            plan: true,
        },
    });

    if (!organization || !isFeatureAvailable(organization, PremiumFeature.PUBLIC_ORGANIZATION_PAGE)) {
        throw new Error("ORGANIZATION_PUBLIC_PAGE_NOT_AVAILABLE");
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

    const brandingAvailable = isFeatureAvailable(organization, PremiumFeature.CUSTOM_BRANDING);

    return {
        organization: {
            id: organization.id,
            name: organization.name,
            slug: organization.slug,
            description: organization.description,
            city: organization.city,
            province: organization.province,
            website: organization.website,
            instagram: organization.instagram,
            facebook: organization.facebook,
            tiktok: organization.tiktok,
        },
        branding: brandingAvailable
            ? {
                  enabled: true,
                  logo: organization.logo,
                  primaryColor: organization.brandPrimaryColor,
                  secondaryColor: organization.brandSecondaryColor,
              }
            : { enabled: false, logo: null, primaryColor: null, secondaryColor: null },
        events: events.map((event) => ({
            ...event,
            organization: { id: organization.id, name: organization.name },
        })),
    };
};

// Premium 2E — "Organizaciones destacadas" en Home. V1: NO es un ranking
// de popularidad, es únicamente la selección de Organizations que pueden
// tener página pública Premium (misma autoridad que
// getPublicOrganizationBySlugService), ordenada de forma determinista.
//
// Elegibilidad: EXACTAMENTE la misma que habilita `/organizacion/:slug`
// (isFeatureAvailable(organization, PremiumFeature.PUBLIC_ORGANIZATION_PAGE)
// + slug no nulo) — nunca se muestra acá una Organization cuyo click
// terminaría en ORGANIZATION_PUBLIC_PAGE_NOT_AVAILABLE. Filtrado
// DIRECTAMENTE en la query Prisma (`plan: "PREMIUM"`) en vez de traer todo
// y filtrar en JS con `isFeatureAvailable` fila por fila: hoy
// isFeatureAvailable(org, PUBLIC_ORGANIZATION_PAGE) es exactamente
// isPremium(org) (ver organizationPlanPolicy.js — no depende de ningún
// otro campo de Organization), así que ambas formas son equivalentes y
// filtrar en la query evita traer organizaciones que después se
// descartarían igual. Si esa policy alguna vez agrega una condición que
// no sea derivable de `plan` en SQL, este filtro debe revisarse.
//
// Orden V1 (deliberadamente simple, NO "popularidad"): `updatedAt desc,
// id desc` — no existe todavía ninguna señal de actividad real
// (eventos/ventas) que se pueda leer sin agregar joins/agregaciones
// nuevas fuera de alcance de esta fase; `updatedAt` es el único campo ya
// existente que se aproxima a "organización con actividad reciente en su
// perfil", e `id` (cuid) es el desempate estable para que el orden sea
// 100% determinista incluso ante timestamps iguales.
const MAX_FEATURED_ORGANIZATIONS = 10;

export const getFeaturedOrganizationsService = async () => {
    const organizations = await prisma.organization.findMany({
        where: {
            plan: "PREMIUM",
            slug: { not: null },
        },
        select: {
            id: true,
            name: true,
            slug: true,
            logo: true,
            city: true,
            province: true,
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: MAX_FEATURED_ORGANIZATIONS,
    });

    return { organizations };
};

// Premium — Fase 2D / 2D.1.1. Whitelist EXCLUSIVA: logo, brandPrimaryColor
// y brandSecondaryColor. Nada de website/redes/description/name/slug acá —
// esos siguen siendo datos generales de Organization (PATCH /me). El
// downgrade PREMIUM→FREE nunca borra logo/brandPrimaryColor/
// brandSecondaryColor ya guardados: sólo deja de permitir que se sigan
// editando (y de exponerlos en la página pública) hasta que la Organization
// vuelva a ser PREMIUM.
export const updateOrganizationBrandingService = async (clerkId, organizationId, input) => {
    const user = await getUserByClerkId(clerkId);

    if (!user) {
        throw new Error("USER_NOT_SYNCED");
    }

    const organization = await prisma.organization.findUnique({
        where: { id: organizationId },
    });

    if (!organization) {
        throw new Error("ORGANIZATION_NOT_FOUND");
    }

    if (organization.ownerId !== user.id) {
        throw new Error("ORGANIZATION_BRANDING_FORBIDDEN");
    }

    if (!isFeatureAvailable(organization, PremiumFeature.CUSTOM_BRANDING)) {
        throw new Error("PREMIUM_FEATURE_REQUIRED");
    }

    const data = {};

    if (Object.hasOwn(input, "logo")) {
        data.logo = input.logo || null;
    }

    if (Object.hasOwn(input, "brandPrimaryColor")) {
        const value = input.brandPrimaryColor;
        if (value !== null && !isValidHexColor(value)) {
            throw new Error("ORGANIZATION_BRANDING_INVALID_COLOR");
        }
        data.brandPrimaryColor = value;
    }

    if (Object.hasOwn(input, "brandSecondaryColor")) {
        const value = input.brandSecondaryColor;
        if (value !== null && !isValidHexColor(value)) {
            throw new Error("ORGANIZATION_BRANDING_INVALID_COLOR");
        }
        data.brandSecondaryColor = value;
    }

    const updated = await prisma.organization.update({
        where: { id: organizationId },
        data,
    });

    return {
        id: updated.id,
        logo: updated.logo,
        brandPrimaryColor: updated.brandPrimaryColor,
        brandSecondaryColor: updated.brandSecondaryColor,
    };
};
