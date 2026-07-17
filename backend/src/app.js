import express from "express";
import cors from "cors";
import { clerkMiddleware } from "@clerk/express";

import userRoutes from "./routes/user.routes.js";
import authRoutes from "./routes/auth.routes.js";
import organizationRoutes from "./routes/organization.routes.js";
import mediaRoutes from "./routes/media.routes.js";
import eventRoutes from "./routes/event.routes.js";

const app = express();

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

export default app;