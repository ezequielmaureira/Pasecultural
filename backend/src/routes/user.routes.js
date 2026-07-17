import { Router } from "express";
import {
    getUsers,
    getUsersCount,
    getUserById,
    updateUserRole,
    updateUserStatus,
    deleteUser,
} from "../controllers/user.controller.js";
import { requireRole } from "../middlewares/requireRole.js";

const router = Router();

router.get("/", requireRole("DEVELOPER"), getUsers);
router.get("/count", requireRole("DEVELOPER"), getUsersCount);
router.get("/:id", requireRole("DEVELOPER"), getUserById);
router.patch("/:id/role", requireRole("DEVELOPER"), updateUserRole);
router.patch("/:id/status", requireRole("DEVELOPER"), updateUserStatus);
router.delete("/:id", requireRole("DEVELOPER"), deleteUser);

export default router;
