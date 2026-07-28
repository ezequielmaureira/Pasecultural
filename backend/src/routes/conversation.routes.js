import { Router } from "express";
import {
    startConversation,
    replyConversation,
    getConversation,
    cancelConversation,
} from "../controllers/conversation.controller.js";
import { requireAuth } from "../middlewares/requireAuth.js";

const router = Router();

router.post("/start", requireAuth, startConversation);
router.get("/:id", requireAuth, getConversation);
router.post("/:id/reply", requireAuth, replyConversation);
router.delete("/:id", requireAuth, cancelConversation);

export default router;
