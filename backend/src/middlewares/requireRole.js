import { getAuth } from "@clerk/express";
import prisma from "../config/prisma.js";

export function requireRole(...roles) {
    return async (req, res, next) => {
        const { userId } = getAuth(req);

        if (!userId) {
            return res.status(401).json({ message: "No autenticado" });
        }

        const user = await prisma.user.findUnique({
            where: { clerkId: userId },
        });

        if (!user) {
            return res.status(401).json({
                message: "Usuario no sincronizado. Volvé a iniciar sesión.",
            });
        }

        if (!roles.includes(user.role)) {
            return res.status(403).json({
                message: "No tenés permisos para acceder a este recurso",
            });
        }

        req.dbUser = user;
        next();
    };
}
