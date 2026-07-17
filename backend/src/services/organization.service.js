import prisma from "../config/prisma.js";

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

    return { organization, user: updatedUser };
};

const UPDATABLE_FIELDS = [
    "name",
    "type",
    "description",
    "logo",
    "phone",
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

export const getOrganizationsService = async (status) => {
    const where =
        status && ORGANIZATION_STATUSES.has(status) ? { status } : {};

    return prisma.organization.findMany({
        where,
        include: { owner: true },
        orderBy: { createdAt: "desc" },
    });
};

export const getOrganizationByIdService = async (id) => {
    return prisma.organization.findUnique({
        where: { id },
        include: { owner: true },
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

export const deleteOrganizationService = async (id) => {
    await prisma.organization.delete({ where: { id } });
};
