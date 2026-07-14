import { Router } from "express";
import {
    getUsers,
    getUsersCount,
} from "../controllers/user.controller.js";

const router = Router();

router.get("/", getUsers);

router.get("/count", getUsersCount);

export default router;