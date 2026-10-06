import { getAuth } from "@clerk/express";
import prisma from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";

// Clerk es el proveedor de IDENTIDAD; la AUTORIZACIÓN la decide el User
// interno. Un User con status distinto de ACTIVE (hoy: SUSPENDED) no opera
// ningún endpoint autenticado aunque su sesión Clerk sea válida. La
// suspensión es reversible desde Developer → Usuarios: no se toca Clerk.
// Compartido con requireRole para no duplicar la regla.
export function isUserBlocked(user) {
    return Boolean(user) && user.status !== "ACTIVE";
}

export async function requireAuth(req, res, next) {
    const { userId } = getAuth(req);

    if (!userId) {
        return res.status(401).json({ message: "No autenticado" });
    }

    // Un usuario Clerk todavía sin User interno (antes del primer
    // /api/auth/sync) sigue pasando como antes: no existe fila que pueda
    // estar suspendida, y cada service ya maneja USER_NOT_SYNCED.
    const user = await prisma.user.findUnique({
        where: { clerkId: userId },
    });

    if (isUserBlocked(user)) {
        return next(new AppError(ErrorCodes.USER_SUSPENDED));
    }

    next();
}
