import { getAuth } from "@clerk/express";
import {
    createOrganizationService,
    getMyOrganizationService,
} from "../services/organization.service.js";

export const getMyOrganization = async (req, res) => {
    try {
        const { userId } = getAuth(req);

        if (!userId) {
            return res.status(401).json({ message: "No autenticado" });
        }

        const organization = await getMyOrganizationService(userId);

        res.status(200).json({ organization });
    } catch (error) {
        console.error(error);

        res.status(500).json({
            message: "Error al obtener la organización",
        });
    }
};

export const createOrganization = async (req, res) => {
    try {
        const { userId } = getAuth(req);

        if (!userId) {
            return res.status(401).json({ message: "No autenticado" });
        }

        const { name, email } = req.body;

        if (!name || !email) {
            return res.status(400).json({
                message: "El nombre y el email son obligatorios",
            });
        }

        const { organization, user } = await createOrganizationService(
            userId,
            req.body
        );

        res.status(201).json({ organization, user });
    } catch (error) {
        console.error(error);

        if (error.message === "USER_NOT_SYNCED") {
            return res.status(409).json({
                message: "Usuario no sincronizado. Volvé a iniciar sesión.",
            });
        }

        res.status(500).json({
            message: "Error al crear la organización",
        });
    }
};
