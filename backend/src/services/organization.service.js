import prisma from "../config/prisma.js";

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
    { name, description, phone, email, website, cuit }
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
            description: description || null,
            phone: phone || null,
            email,
            website: website || null,
            cuit: cuit || null,
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
