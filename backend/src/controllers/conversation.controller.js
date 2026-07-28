import { getAuth } from "@clerk/express";
import * as EventCreationEngine from "../conversation/EventCreationEngine.js";

export const startConversation = async (req, res) => {
    try {
        const { userId } = getAuth(req);
        if (!userId) {
            return res.status(401).json({ message: "No autenticado" });
        }

        const result = await EventCreationEngine.start({
            clerkId: userId,
            channel: "WEB",
            channelRef: userId,
        });
        res.status(201).json(result);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error al iniciar la conversación" });
    }
};

export const replyConversation = async (req, res) => {
    try {
        const { userId } = getAuth(req);
        if (!userId) {
            return res.status(401).json({ message: "No autenticado" });
        }

        const result = await EventCreationEngine.handleInput(req.params.id, req.body);
        res.status(200).json(result);
    } catch (error) {
        if (error.message === "CONVERSATION_NOT_FOUND") {
            return res.status(404).json({ message: "No encontramos esa conversación" });
        }
        if (error.message === "CONVERSATION_CLOSED") {
            return res.status(409).json({ message: "Esa conversación ya terminó" });
        }
        console.error(error);
        res.status(500).json({ message: "Error al procesar tu respuesta" });
    }
};

export const cancelConversation = async (req, res) => {
    try {
        const { userId } = getAuth(req);
        if (!userId) {
            return res.status(401).json({ message: "No autenticado" });
        }

        await EventCreationEngine.cancel(req.params.id, userId);
        res.status(204).send();
    } catch (error) {
        if (error.message === "CONVERSATION_NOT_FOUND") {
            return res.status(404).json({ message: "No encontramos esa conversación" });
        }
        if (error.message === "CONVERSATION_FORBIDDEN") {
            return res.status(403).json({ message: "No podés descartar esta conversación" });
        }
        console.error(error);
        res.status(500).json({ message: "Error al descartar el borrador" });
    }
};

export const getConversation = async (req, res) => {
    try {
        const { userId } = getAuth(req);
        if (!userId) {
            return res.status(401).json({ message: "No autenticado" });
        }

        const result = await EventCreationEngine.resume(req.params.id);
        res.status(200).json(result);
    } catch (error) {
        if (error.message === "CONVERSATION_NOT_FOUND") {
            return res.status(404).json({ message: "No encontramos esa conversación" });
        }
        console.error(error);
        res.status(500).json({ message: "Error al recuperar la conversación" });
    }
};
