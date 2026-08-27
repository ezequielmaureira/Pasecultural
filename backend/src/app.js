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
import courtesyRoutes from "./routes/courtesy.routes.js";
import withdrawalRequestRoutes from "./routes/withdrawalRequest.routes.js";
import organizerNotificationSettingsRoutes from "./routes/organizerNotificationSettings.routes.js";
import ticketRoutes from "./routes/ticket.routes.js";
import scannerRoutes from "./routes/scanner.routes.js";
import scannerInvitationRoutes from "./routes/scannerInvitation.routes.js";
import scannerAuthRoutes from "./routes/scannerAuth.routes.js";
import devToolsRoutes from "./routes/devTools.routes.js";
import developerDashboardRoutes from "./routes/developerDashboard.routes.js";
import developerEventsRoutes from "./routes/developerEvents.routes.js";
import developerTicketsRoutes from "./routes/developerTickets.routes.js";
import developerScannersRoutes from "./routes/developerScanners.routes.js";
import developerSalesRoutes from "./routes/developerSales.routes.js";
import developerServiceFeeRoutes from "./routes/developerServiceFee.routes.js";
import developerAlertConfigRoutes from "./routes/developerAlertConfig.routes.js";
import publicLaunchSettingsRoutes from "./routes/publicLaunchSettings.routes.js";
import publicLaunchStatusRoutes from "./routes/publicLaunchStatus.routes.js";
import whatsappRoutes from "./routes/whatsapp.routes.js";
import mercadoPagoRoutes from "./routes/mercadoPago.routes.js";
import { errorHandler } from "./errors/index.js";

const app = express();

// Necesario para que req.ip refleje la IP real del visitante (no la del
// proxy de Render) — lo usa el rate limiter de los endpoints públicos de
// recuperación de compra (ver middlewares/rateLimit.js). "1" = confía
// exactamente un hop hacia atrás, que es el proxy de Render.
app.set("trust proxy", 1);

app.use(cors());
// Verificación de teléfono de Organizaciones — captura los bytes CRUDOS de
// cada request (req.rawBody) además del body ya parseado, sin cambiar el
// comportamiento de parseo para NADIE: sólo agrega un buffer extra en
// memoria. Lo usa únicamente whatsapp.controller.js (X-Hub-Signature-256,
// ver config/whatsappWebhookSignature.js) — un HMAC tiene que firmarse
// sobre los bytes exactos que mandó Meta, nunca sobre un JSON re-serializado.
app.use(
    express.json({
        verify: (req, res, buf) => {
            req.rawBody = buf;
        },
    })
);
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
app.use("/api/courtesies", courtesyRoutes);
// Botón de arrepentimiento — recurso propio (mismo criterio que
// /api/courtesies: un dominio con forma propia, no forzado dentro de
// /api/sales). Público sin sesión para el flujo OTP + registrar la
// solicitud (autorizado por token, nunca por Clerk); requireRole recién
// adentro para el panel Organizer/Developer. Ver
// routes/withdrawalRequest.routes.js.
app.use("/api/withdrawal-requests", withdrawalRequestRoutes);
// Notificaciones Organizer — Dashboard Organizador > Configuración >
// Notificaciones (GET/PUT /api/organizer/notification-settings). Prefijo
// nuevo, sin router "/api/organizer" previo — mismo criterio que
// "/api/developer" agrupa varios routers Developer bajo un prefijo común.
app.use("/api/organizer", organizerNotificationSettingsRoutes);
app.use("/api/tickets", ticketRoutes);
app.use("/api/scanner", scannerRoutes);
app.use("/api/scanner-invitations", scannerInvitationRoutes);
app.use("/api/scanner-auth", scannerAuthRoutes);
// Sólo DEVELOPER (ver devTools.routes.js) — panel "Base de Datos" para
// reiniciar/sembrar la base. Protección simplificada temporalmente: todavía
// no hay producción con clientes reales. Reincorporar una capa extra
// cuando la haya.
app.use("/api/dev", devToolsRoutes);
// Panel de control real de la plataforma (Dashboard Developer V1) — sólo
// GET /api/developer/dashboard, agregaciones platform-wide, exclusivo
// DEVELOPER. Ver developerDashboard.service.js.
app.use("/api/developer", developerDashboardRoutes);
// Mismo prefijo "/api/developer", segundo router montado en paralelo (sin
// tocar developerDashboard.routes.js) — Developer → Eventos: GET
// /api/developer/events y GET /api/developer/organizations/options. Sólo
// lectura, platform-wide, exclusivo DEVELOPER. Ver developerEvents.service.js.
app.use("/api/developer", developerEventsRoutes);
// Mismo prefijo "/api/developer", tercer router en paralelo (sin tocar
// developerDashboard.routes.js ni developerEvents.routes.js) — Developer →
// Entradas: GET /api/developer/tickets, GET /api/developer/tickets/:id y
// GET /api/developer/events/options (dropdown en cascada, vive acá para no
// tocar developerEvents.routes.js). Sólo lectura, platform-wide, exclusivo
// DEVELOPER. Ver developerTickets.service.js.
app.use("/api/developer", developerTicketsRoutes);
// Mismo prefijo "/api/developer", cuarto router en paralelo (sin tocar
// developerDashboard/developerEvents/developerTickets.routes.js) —
// Developer → Scanners: GET /api/developer/scanners y GET
// /api/developer/scanners/:id. Sólo lectura, platform-wide, exclusivo
// DEVELOPER. Ver developerScanners.service.js.
app.use("/api/developer", developerScannersRoutes);
// Mismo prefijo "/api/developer", quinto router en paralelo (sin tocar
// developerDashboard/developerEvents/developerTickets/developerScanners.routes.js)
// — Developer → Ventas: GET /api/developer/sales y GET
// /api/developer/sales/:id. Sólo lectura, platform-wide, exclusivo
// DEVELOPER. Ver developerSales.service.js.
app.use("/api/developer", developerSalesRoutes);
// Mismo prefijo "/api/developer", sexto router en paralelo (sin tocar
// developerDashboard/developerEvents/developerTickets/developerScanners/
// developerSales.routes.js) — MP-6, Developer → Configuración: GET/PUT
// /api/developer/service-fee (rangos de comisión de servicio). Exclusivo
// DEVELOPER. Ver developerServiceFee.service.js.
app.use("/api/developer", developerServiceFeeRoutes);
// Mismo prefijo "/api/developer", séptimo router en paralelo (sin tocar
// ninguno de los anteriores) — Alertas Developer, Developer > Configuración:
// GET/PUT /api/developer/alert-config (umbrales de las alertas de patrón/
// volumen: precio de entrada, cantidad por compra, eventos/ventas/refunds
// por ventana de tiempo, cooldown). Exclusivo DEVELOPER. Ver
// developerAlertConfig.service.js.
app.use("/api/developer", developerAlertConfigRoutes);
// Mismo prefijo "/api/developer", octavo router en paralelo (sin tocar
// ninguno de los anteriores) — Modo Prelanzamiento, Developer >
// Configuración: GET/PUT /api/developer/launch-status (estado público de
// PaseCultural). Exclusivo DEVELOPER. Ver publicLaunchSettings.service.js.
app.use("/api/developer", publicLaunchSettingsRoutes);
// Router propio, prefijo nuevo "/api/public" — SIN auth: GET
// /api/public/launch-status, lo necesita cualquier visitante anónimo antes
// de que exista sesión. Nunca agregar otros endpoints públicos de datos
// acá — ver publicLaunchStatus.routes.js.
app.use("/api/public", publicLaunchStatusRoutes);
// Webhook de Meta WhatsApp Cloud API — Fase 2A: sólo verificación GET y
// recepción POST del webhook, público (Meta no manda ningún header de
// sesión de PaseCultural). No conecta EventCreationEngine/EventServicePort
// todavía. Ver whatsapp.controller.js.
app.use("/api/whatsapp", whatsappRoutes);
// MP-1 — onboarding OAuth de Mercado Pago. Sólo el callback público
// (GET /oauth/callback, Mercado Pago redirige acá el navegador del
// organizador); los endpoints autenticados (status/connect) viven bajo
// /api/organizations/me/mercadopago, ver organization.routes.js.
app.use("/api/mercadopago", mercadoPagoRoutes);

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
// handler async). El resto de los controllers todavía arma sus propias
// respuestas a mano dentro de cada catch (no cambia nada de eso); sólo
// devTools.controller.js usa next(error)/AppError por ahora.
app.use(errorHandler);

export default app;