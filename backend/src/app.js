import express from "express";
import cors from "cors";
import { clerkMiddleware } from "@clerk/express";
import prisma from "./config/prisma.js";

import userRoutes from "./routes/user.routes.js";
import authRoutes from "./routes/auth.routes.js";
import organizationRoutes from "./routes/organization.routes.js";
import mediaRoutes from "./routes/media.routes.js";
import eventRoutes from "./routes/event.routes.js";
import conversationRoutes from "./routes/conversation.routes.js";
import saleRoutes from "./routes/sale.routes.js";
import ticketRoutes from "./routes/ticket.routes.js";
import scannerRoutes from "./routes/scanner.routes.js";
import { errorHandler } from "./errors/index.js";

const app = express();

// Necesario para que req.ip refleje la IP real del visitante (no la del
// proxy de Render) — lo usa el rate limiter de los endpoints públicos de
// recuperación de compra (ver middlewares/rateLimit.js). "1" = confía
// exactamente un hop hacia atrás, que es el proxy de Render.
app.set("trust proxy", 1);

app.use(cors());
app.use(express.json());
app.use(clerkMiddleware());

// Health Check
app.get("/api/health", (req, res) => {
    res.status(200).json({
        ok: true,
        message: "PaseCultural API funcionando 🚀",
    });
});

// Rutas
app.use("/api/users", userRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/organizations", organizationRoutes);
app.use("/api/media", mediaRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/conversations", conversationRoutes);
app.use("/api/sales", saleRoutes);
app.use("/api/tickets", ticketRoutes);
app.use("/api/scanner", scannerRoutes);

app.get("/debug/prisma-user", async (req, res) => {
    try {
        const user = await prisma.user.create({
            data: {
                email: "debug@test.com",
                firstName: "Debug",
                lastName: "Debug",
                clerkId: null,
            },
        });
        res.json({ success: true, user, renderGitCommit: process.env.RENDER_GIT_COMMIT ?? null, prismaClientVersion: prisma._clientVersion ?? null });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: {
                message: error.message,
                stack: error.stack,
                name: error.name,
                code: error.code,
                clientVersion: prisma._clientVersion ?? null,
                renderGitCommit: process.env.RENDER_GIT_COMMIT ?? null,
                raw: JSON.parse(JSON.stringify(error, Object.getOwnPropertyNames(error))),
            },
        });
    }
});

// Único middleware de manejo de errores de toda la app: se registra al
// final para que Express lo use como fallback de cualquier error que
// llegue por next(error) (o que Express 5 reenvíe automáticamente desde un
// handler async). Todavía ningún controller llama a next(error)
// explícitamente, así que este paso es aditivo puro: no cambia ninguna
// respuesta existente.
app.use(errorHandler);

export default app;