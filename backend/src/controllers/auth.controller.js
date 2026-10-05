import { clerkClient, getAuth } from "@clerk/express";
import { syncUserService, deleteMyAccountService } from "../services/auth.service.js";
import { AppError } from "../errors/AppError.js";

export const syncUser = async (req, res) => {
    try {
        const { userId } = getAuth(req);

        if (!userId) {
            return res.status(401).json({ message: "No autenticado" });
        }

        const clerkUser = await clerkClient.users.getUser(userId);

        const user = await syncUserService({
            clerkId: clerkUser.id,
            email: clerkUser.primaryEmailAddress?.emailAddress ?? "",
            firstName: clerkUser.firstName,
            lastName: clerkUser.lastName,
            imageUrl: clerkUser.imageUrl,
        });

        res.status(200).json(user);
    } catch (error) {
        console.error(error);

        res.status(500).json({
            message: "Error al sincronizar el usuario",
        });
    }
};

// DELETE /api/auth/me — autoservicio "Eliminar mi cuenta". La identidad
// sale SIEMPRE de la sesión Clerk (getAuth); del body sólo se lee la
// confirmación escrita. Ver deleteMyAccountService.
export const deleteMyAccount = async (req, res, next) => {
    try {
        const { userId } = getAuth(req);
        const result = await deleteMyAccountService(userId, { confirmation: req.body?.confirmation });
        res.status(200).json(result);
    } catch (error) {
        next(AppError.from(error));
    }
};
