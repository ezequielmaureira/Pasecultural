import { getAuth } from "@clerk/express";
import {
    createOrganizationService,
    getMyOrganizationService,
    updateMyOrganizationService,
    deleteMyOrganizationService,
    getOrganizationsService,
    getOrganizationByIdService,
    updateOrganizationStatusService,
    updateOrganizationPlanService,
    deleteOrganizationService,
} from "../services/organization.service.js";
import { validateOrganizationInput } from "../utils/validateOrganization.js";

const VALID_STATUSES = new Set(["PENDING", "APPROVED", "REJECTED", "SUSPENDED"]);
const VALID_PLANS = new Set(["FREE", "PREMIUM"]);

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

        const errors = validateOrganizationInput(req.body);

        if (errors.length > 0) {
            return res.status(400).json({
                message: "Revisá los datos de la organización",
                errors,
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

export const updateMyOrganization = async (req, res) => {
    try {
        const { userId } = getAuth(req);

        if (!userId) {
            return res.status(401).json({ message: "No autenticado" });
        }

        const organization = await updateMyOrganizationService(userId, req.body);

        if (!organization) {
            return res.status(404).json({
                message: "No tenés una organización creada",
            });
        }

        res.status(200).json({ organization });
    } catch (error) {
        console.error(error);

        if (error.message === "USER_NOT_SYNCED") {
            return res.status(409).json({
                message: "Usuario no sincronizado. Volvé a iniciar sesión.",
            });
        }

        res.status(500).json({
            message: "Error al actualizar la organización",
        });
    }
};

export const deleteMyOrganization = async (req, res) => {
    try {
        const { userId } = getAuth(req);

        if (!userId) {
            return res.status(401).json({ message: "No autenticado" });
        }

        const deleted = await deleteMyOrganizationService(userId);

        if (!deleted) {
            return res.status(404).json({
                message: "No tenés una organización creada",
            });
        }

        res.status(204).send();
    } catch (error) {
        console.error(error);

        if (error.message === "USER_NOT_SYNCED") {
            return res.status(409).json({
                message: "Usuario no sincronizado. Volvé a iniciar sesión.",
            });
        }

        res.status(500).json({
            message: "Error al eliminar la organización",
        });
    }
};

export const getOrganizations = async (req, res) => {
    try {
        const { status } = req.query;

        const organizations = await getOrganizationsService(status);

        res.status(200).json({ organizations });
    } catch (error) {
        console.error(error);

        res.status(500).json({
            message: "Error al obtener las organizaciones",
        });
    }
};

export const getOrganizationById = async (req, res) => {
    try {
        const organization = await getOrganizationByIdService(req.params.id);

        if (!organization) {
            return res.status(404).json({
                message: "Organización no encontrada",
            });
        }

        res.status(200).json({ organization });
    } catch (error) {
        console.error(error);

        res.status(500).json({
            message: "Error al obtener la organización",
        });
    }
};

export const updateOrganizationStatus = async (req, res) => {
    try {
        const { status } = req.body;

        if (!VALID_STATUSES.has(status)) {
            return res.status(400).json({
                message: "Estado inválido",
            });
        }

        const organization = await updateOrganizationStatusService(
            req.params.id,
            status,
            req.dbUser.id
        );

        if (!organization) {
            return res.status(404).json({
                message: "Organización no encontrada",
            });
        }

        res.status(200).json({ organization });
    } catch (error) {
        console.error(error);

        res.status(500).json({
            message: "Error al actualizar el estado de la organización",
        });
    }
};

// Premium — Fase 1, mismo patrón exacto que updateOrganizationStatus de
// acá arriba. req.dbUser ya viene resuelto por requireRole("DEVELOPER")
// (ver organization.routes.js) — nunca se vuelve a resolver acá.
export const updateOrganizationPlan = async (req, res) => {
    try {
        const { plan } = req.body;

        if (!VALID_PLANS.has(plan)) {
            return res.status(400).json({
                message: "Plan inválido",
            });
        }

        const organization = await updateOrganizationPlanService(
            req.params.id,
            plan,
            req.dbUser.id
        );

        if (!organization) {
            return res.status(404).json({
                message: "Organización no encontrada",
            });
        }

        res.status(200).json({ organization });
    } catch (error) {
        console.error(error);

        res.status(500).json({
            message: "Error al actualizar el plan de la organización",
        });
    }
};

export const deleteOrganization = async (req, res) => {
    try {
        await deleteOrganizationService(req.params.id);

        res.status(204).send();
    } catch (error) {
        console.error(error);

        if (error.code === "P2025") {
            return res.status(404).json({
                message: "Organización no encontrada",
            });
        }

        res.status(500).json({
            message: "Error al eliminar la organización",
        });
    }
};
