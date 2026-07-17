import prisma from "../config/prisma.js";

const ROLES = new Set(["DEVELOPER", "ORGANIZER", "SCANNER", "CUSTOMER"]);
const USER_STATUSES = new Set(["ACTIVE", "SUSPENDED"]);

export const getUsersService = async ({ role, search } = {}) => {
    const where = {};

    if (role && ROLES.has(role)) {
        where.role = role;
    }

    if (search && search.trim()) {
        const term = search.trim();
        where.OR = [
            { firstName: { contains: term, mode: "insensitive" } },
            { lastName: { contains: term, mode: "insensitive" } },
            { email: { contains: term, mode: "insensitive" } },
        ];
    }

    return prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
    });
};

export const getUsersCountService = async () => {
    return prisma.user.count();
};

export const getUserByIdService = async (id) => {
    return prisma.user.findUnique({
        where: { id },
        include: { organizations: true },
    });
};

export const updateUserRoleService = async (id, role) => {
    if (!ROLES.has(role)) {
        throw new Error("INVALID_ROLE");
    }

    return prisma.user.update({
        where: { id },
        data: { role },
    });
};

export const updateUserStatusService = async (id, status) => {
    if (!USER_STATUSES.has(status)) {
        throw new Error("INVALID_STATUS");
    }

    return prisma.user.update({
        where: { id },
        data: { status },
    });
};

export const deleteUserService = async (id) => {
    await prisma.user.delete({ where: { id } });
};
