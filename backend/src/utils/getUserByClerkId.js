import prisma from "../config/prisma.js";

export async function getUserByClerkId(clerkId) {
    return prisma.user.findUnique({ where: { clerkId } });
}
