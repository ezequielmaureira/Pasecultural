import {
    getUsersService,
    getUsersCountService,
    getUserByIdService,
    updateUserRoleService,
    updateUserStatusService,
    deleteUserService,
} from "../services/user.service.js";

const VALID_ROLES = new Set(["DEVELOPER", "ORGANIZER", "SCANNER", "CUSTOMER"]);
const VALID_STATUSES = new Set(["ACTIVE", "SUSPENDED"]);

export const getUsers = async (req, res) => {
    try {
        const { role, search } = req.query;

        const users = await getUsersService({ role, search });

        res.status(200).json({ users });
    } catch (error) {
        console.error(error);

        res.status(500).json({
            message: "Error al obtener los usuarios",
        });
    }
};

export const getUsersCount = async (req, res) => {
    try {
        const total = await getUsersCountService();

        res.status(200).json({
            total,
        });
    } catch (error) {
        console.error(error);

        res.status(500).json({
            message: "Error al obtener la cantidad de usuarios",
        });
    }
};

export const getUserById = async (req, res) => {
    try {
        const user = await getUserByIdService(req.params.id);

        if (!user) {
            return res.status(404).json({ message: "Usuario no encontrado" });
        }

        res.status(200).json({ user });
    } catch (error) {
        console.error(error);

        res.status(500).json({
            message: "Error al obtener el usuario",
        });
    }
};

export const updateUserRole = async (req, res) => {
    try {
        const { role } = req.body;

        if (!VALID_ROLES.has(role)) {
            return res.status(400).json({ message: "Rol inválido" });
        }

        const user = await updateUserRoleService(req.params.id, role);

        res.status(200).json({ user });
    } catch (error) {
        console.error(error);

        if (error.code === "P2025") {
            return res.status(404).json({ message: "Usuario no encontrado" });
        }

        res.status(500).json({
            message: "Error al actualizar el rol del usuario",
        });
    }
};

export const updateUserStatus = async (req, res) => {
    try {
        const { status } = req.body;

        if (!VALID_STATUSES.has(status)) {
            return res.status(400).json({ message: "Estado inválido" });
        }

        if (status === "SUSPENDED" && req.params.id === req.dbUser.id) {
            return res.status(400).json({
                message: "No podés suspender tu propia cuenta",
            });
        }

        const user = await updateUserStatusService(req.params.id, status);

        res.status(200).json({ user });
    } catch (error) {
        console.error(error);

        if (error.code === "P2025") {
            return res.status(404).json({ message: "Usuario no encontrado" });
        }

        res.status(500).json({
            message: "Error al actualizar el estado del usuario",
        });
    }
};

export const deleteUser = async (req, res) => {
    try {
        if (req.params.id === req.dbUser.id) {
            return res.status(400).json({
                message: "No podés eliminar tu propio usuario",
            });
        }

        await deleteUserService(req.params.id);

        res.status(204).send();
    } catch (error) {
        console.error(error);

        if (error.code === "P2025") {
            return res.status(404).json({ message: "Usuario no encontrado" });
        }

        if (error.code === "P2003") {
            return res.status(409).json({
                message:
                    "No se puede eliminar: el usuario tiene una organización asociada",
            });
        }

        res.status(500).json({
            message: "Error al eliminar el usuario",
        });
    }
};
