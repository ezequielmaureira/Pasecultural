import { clerkClient, getAuth } from "@clerk/express";
import { syncUserService } from "../services/auth.service.js";

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