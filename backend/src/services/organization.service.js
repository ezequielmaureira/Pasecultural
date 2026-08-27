import prisma from "../config/prisma.js";
import { logger } from "../logging/logger.js";
import { sendDeveloperAlert, DeveloperAlertType } from "./email/sendDeveloperAlert.service.js";

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

export const getMyOrganizationService = async (clerkId) => {
    const user = await getUserByClerkId(clerkId);

    if (!user) return null;

    return prisma.organization.findFirst({
        where: {
            ownerId: user.id,
        },
    });
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

    const organization = await prisma.organization.create({
        data: {
            name,
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
