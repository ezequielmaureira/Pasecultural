import prisma from "../config/prisma.js";

const ROLES = new Set(["DEVELOPER", "ORGANIZER", "SCANNER", "CUSTOMER"]);
const USER_STATUSES = new Set(["ACTIVE", "SUSPENDED"]);

// Usado exclusivamente por Developer → Usuarios (user.controller.js, las 6
// rutas de user.routes.js son requireRole("DEVELOPER") sin excepción — sin
// otro consumidor en el resto del backend). Select explícito para no
// devolver la fila completa de User: nunca clerkId (id interno de Clerk,
// sin uso en esta pantalla) ni ningún otro campo que DeveloperUsers.jsx/
// UserDetailModal.jsx no lean. Son exactamente los campos que ambos
// consumen hoy (verificado contra el código real de los dos).
const DEVELOPER_USER_SELECT = {
    id: true,
    email: true,
    firstName: true,
    lastName: true,
    imageUrl: true,
    role: true,
    status: true,
    createdAt: true,
};

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
        select: DEVELOPER_USER_SELECT,
    });
};

export const getUsersCountService = async () => {
    return prisma.user.count();
};

// `organizations` no se selecciona: ni DeveloperUsers.jsx ni
// UserDetailModal.jsx leen `user.organizations` — el `include` anterior
// traía todas las Organization completas del usuario sin que nada las
// mostrara.
export const getUserByIdService = async (id) => {
    return prisma.user.findUnique({
        where: { id },
        select: DEVELOPER_USER_SELECT,
    });
};

export const updateUserRoleService = async (id, role) => {
    if (!ROLES.has(role)) {
        throw new Error("INVALID_ROLE");
    }

    return prisma.user.update({
        where: { id },
        data: { role },
        select: DEVELOPER_USER_SELECT,
    });
};

export const updateUserStatusService = async (id, status) => {
    if (!USER_STATUSES.has(status)) {
        throw new Error("INVALID_STATUS");
    }

    return prisma.user.update({
        where: { id },
        data: { status },
        select: DEVELOPER_USER_SELECT,
    });
};

export const deleteUserService = async (id) => {
    await prisma.user.delete({ where: { id } });
};
