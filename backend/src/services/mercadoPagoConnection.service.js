import crypto from "node:crypto";
import prisma from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { getUserByClerkId } from "../utils/getUserByClerkId.js";
import { encryptMercadoPagoSecret, decryptMercadoPagoSecret } from "../config/mercadoPagoEncryption.js";
import { buildMercadoPagoAuthorizationUrl, exchangeMercadoPagoAuthorizationCode, refreshMercadoPagoAccessToken } from "./mercadoPago.service.js";
import { logger } from "../logging/logger.js";

// MP-1 — Organization ↔ OAuth ↔ Mercado Pago. Esta fase ÚNICAMENTE
// conecta la cuenta (ver el informe de entrega): no crea preferencias de
// pago, no procesa cobros, no toca Sale/Ticket/PaymentMethod ni
// processPayment() del frontend en absoluto.
//
// `state` de 10 minutos — mismo criterio que la vigencia del authorization
// code de Mercado Pago (también 10 minutos, confirmado contra la
// documentación oficial): no tiene sentido que nuestra propia protección
// CSRF dure más que el code que el usuario va a traer de vuelta.
const STATE_EXPIRY_MS = 10 * 60 * 1000;

// ==================================================================
// Autorización — SIEMPRE clerkId (sesión real) + organizationId EXPLÍCITO,
// nunca inferido con findFirst. Mismo patrón que
// whatsappNumberChange.service.js#resolveOrganizationForOwnerOrThrow
// (duplicado a propósito, no importado desde ahí: son dominios distintos,
// y este archivo no debe depender de la integración de WhatsApp).
// ==================================================================

async function resolveOrganizationForOwnerOrThrow(clerkId, organizationId) {
    if (!organizationId || typeof organizationId !== "string") {
        throw new AppError(ErrorCodes.MERCADOPAGO_ORGANIZATION_REQUIRED);
    }

    const user = await getUserByClerkId(clerkId);
    if (!user) throw new AppError(ErrorCodes.USER_NOT_FOUND);

    const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (!organization || organization.ownerId !== user.id) {
        // Mismo código tanto si la organización no existe como si existe
        // pero no es del usuario autenticado — nunca se revela cuál de los
        // dos casos ocurrió.
        throw new AppError(ErrorCodes.MERCADOPAGO_FORBIDDEN);
    }

    return { user, organization };
}

// ==================================================================
// STATUS — GET .../mercadopago/status. Nunca devuelve accessToken,
// refreshToken, ni mercadoPagoUserId/publicKey/scope (no aportan valor a
// esta pantalla mínima, y evita exponer más superficie de la necesaria) —
// sólo lo que la UI describe: si está conectado, desde cuándo, y si son
// credenciales de producción o de prueba.
// ==================================================================

export async function getMercadoPagoConnectionStatusService(clerkId, organizationId) {
    const { organization } = await resolveOrganizationForOwnerOrThrow(clerkId, organizationId);

    const connection = await prisma.mercadoPagoConnection.findUnique({
        where: { organizationId: organization.id },
        select: { connectedAt: true, liveMode: true },
    });

    return {
        connected: Boolean(connection),
        connectedAt: connection?.connectedAt ?? null,
        liveMode: connection?.liveMode ?? null,
    };
}

// ==================================================================
// CONNECT — GET .../mercadopago/connect. Devuelve {authorizationUrl} como
// JSON (autenticado por Bearer, igual que el resto de la API) en vez de
// hacer un 302 server-side: este proyecto es una SPA que autentica cada
// request con el token de Clerk en el header Authorization, que un
// redirect de navegador de nivel superior NO puede llevar consigo. El
// frontend hace `window.location.href = authorizationUrl` — la navegación
// real hacia Mercado Pago ocurre en el browser, nunca dentro de una
// llamada fetch. Ver el informe de entrega de MP-1 para el detalle
// completo de esta decisión.
// ==================================================================

export async function startMercadoPagoConnectService(clerkId, organizationId) {
    const { user, organization } = await resolveOrganizationForOwnerOrThrow(clerkId, organizationId);

    // Aleatorio de alta entropía — sin ninguna otra función más que
    // autorizar ESTE callback puntual (mismo criterio que
    // Sale.publicRecoveryToken/EventScanner.invitationToken). Nunca se
    // serializa nada dentro del propio valor: organizationId/requestedByUserId
    // viajan en la FILA de la base, nunca en el token mismo.
    const stateToken = crypto.randomBytes(32).toString("base64url");
    const now = new Date();

    await prisma.mercadoPagoOAuthState.create({
        data: {
            stateToken,
            organizationId: organization.id,
            requestedByUserId: user.id,
            expiresAt: new Date(now.getTime() + STATE_EXPIRY_MS),
        },
    });

    logger.info("mercadopago oauth: intento de conexión iniciado", { organizationId: organization.id });
    return { authorizationUrl: buildMercadoPagoAuthorizationUrl(stateToken) };
}

// ==================================================================
// CALLBACK — GET /api/mercadopago/oauth/callback (público, Mercado Pago
// redirige acá sin ninguna sesión de PaseCultural). Devuelve
// {organizationId} en éxito (SÓLO para que el controller arme el redirect
// al frontend — nunca se manda al navegador) — nunca tokens, nunca
// secretos.
// ==================================================================

export async function handleMercadoPagoOAuthCallbackService({ code, state }) {
    if (!state || typeof state !== "string") {
        throw new AppError(ErrorCodes.MERCADOPAGO_STATE_INVALID);
    }
    if (!code || typeof code !== "string") {
        throw new AppError(ErrorCodes.MERCADOPAGO_CODE_REQUIRED);
    }

    const now = new Date();

    // Reclamo atómico del state: sólo avanza si la fila SIGUE existiendo
    // con este stateToken exacto en este instante — dos callbacks
    // concurrentes con el mismo `state` (doble tab, reintento de red,
    // replay) sólo pueden hacer que UNO de los dos gane este delete; el
    // otro ve count===0 y nunca llega a intercambiar el code ni a tocar
    // MercadoPagoConnection. Mismo mecanismo ya probado en este proyecto
    // para WhatsappInboundMessageClaim/WhatsappNumberChangeChallenge.
    const pendingState = await prisma.mercadoPagoOAuthState.findUnique({ where: { stateToken: state } });
    if (!pendingState) {
        throw new AppError(ErrorCodes.MERCADOPAGO_STATE_INVALID);
    }
    if (pendingState.expiresAt < now) {
        // Se descarta igual (nunca queda un state vencido esperando a ser
        // reclamado más tarde) — el error informado sigue siendo EXPIRED,
        // no INVALID, para que el frontend pueda mostrar el mensaje
        // correcto ("volvé a intentarlo") en vez de uno genérico.
        await prisma.mercadoPagoOAuthState.deleteMany({ where: { id: pendingState.id } });
        throw new AppError(ErrorCodes.MERCADOPAGO_STATE_EXPIRED);
    }

    const claim = await prisma.mercadoPagoOAuthState.deleteMany({ where: { id: pendingState.id } });
    if (claim.count === 0) {
        // Otro callback concurrente (o un replay del mismo) ya lo consumió
        // — nunca se procesa dos veces.
        throw new AppError(ErrorCodes.MERCADOPAGO_STATE_INVALID);
    }

    // A partir de acá, ESTA llamada es la única dueña de este intento de
    // autorización — organizationId sale EXCLUSIVAMENTE de la fila que
    // acabamos de reclamar, nunca de ningún parámetro que Mercado Pago
    // reenvíe (Mercado Pago no manda organizationId; si lo mandara, de
    // todas formas no se usaría: la fuente de verdad es siempre nuestro
    // propio `state`).
    const { organizationId } = pendingState;

    const exchange = await exchangeMercadoPagoAuthorizationCode(code).catch((error) => ({ success: false, error: error.message }));
    if (!exchange.success) {
        // Nunca se loguea el code ni ningún token — sólo el motivo que
        // Mercado Pago haya reportado (o el error de red/timeout).
        logger.warn("mercadopago oauth: fallo al intercambiar el authorization code", { organizationId, reason: exchange.error });
        throw new AppError(ErrorCodes.MERCADOPAGO_EXCHANGE_FAILED);
    }

    const accessTokenExpiresAt = new Date(now.getTime() + (exchange.expiresInSeconds ?? 0) * 1000);

    // organizationId @unique en MercadoPagoConnection: un único `upsert`
    // cubre tanto la primera conexión como una reconexión (código nuevo,
    // tokens nuevos) — nunca un delete+create separado, nunca deja tokens
    // viejos expuestos ni la organización sin conexión a mitad de camino.
    await prisma.mercadoPagoConnection.upsert({
        where: { organizationId },
        update: {
            mercadoPagoUserId: exchange.mercadoPagoUserId,
            publicKey: exchange.publicKey,
            accessTokenEncrypted: encryptMercadoPagoSecret(exchange.accessToken),
            refreshTokenEncrypted: encryptMercadoPagoSecret(exchange.refreshToken),
            scope: exchange.scope,
            liveMode: exchange.liveMode,
            accessTokenExpiresAt,
        },
        create: {
            organizationId,
            mercadoPagoUserId: exchange.mercadoPagoUserId,
            publicKey: exchange.publicKey,
            accessTokenEncrypted: encryptMercadoPagoSecret(exchange.accessToken),
            refreshTokenEncrypted: encryptMercadoPagoSecret(exchange.refreshToken),
            scope: exchange.scope,
            liveMode: exchange.liveMode,
            accessTokenExpiresAt,
        },
    });

    logger.info("mercadopago oauth: conexión persistida", { organizationId });
    return { organizationId };
}

// ==================================================================
// Renovación — MP-1 no la programa ni la llama desde ningún lado todavía
// (sin cron, ver el informe de entrega): queda implementada y testeada de
// forma AISLADA para que MP-2 pueda usarla sin tener que rehacer OAuth.
// El refresh_token de la respuesta SIEMPRE reemplaza al anterior (rota en
// cada uso, confirmado contra la documentación oficial de Mercado Pago) —
// se persiste atómicamente junto con el accessToken nuevo, nunca por
// separado.
// ==================================================================

export async function refreshMercadoPagoConnectionTokens(organizationId) {
    const connection = await prisma.mercadoPagoConnection.findUnique({ where: { organizationId } });
    if (!connection) return { refreshed: false, reason: "NOT_CONNECTED" };

    const refreshToken = decryptMercadoPagoSecret(connection.refreshTokenEncrypted);
    const result = await refreshMercadoPagoAccessToken(refreshToken).catch((error) => ({ success: false, error: error.message }));
    if (!result.success) {
        logger.warn("mercadopago oauth: fallo al renovar credenciales", { organizationId, reason: result.error });
        return { refreshed: false, reason: result.error };
    }

    const now = new Date();
    await prisma.mercadoPagoConnection.update({
        where: { organizationId },
        data: {
            accessTokenEncrypted: encryptMercadoPagoSecret(result.accessToken),
            refreshTokenEncrypted: encryptMercadoPagoSecret(result.refreshToken),
            accessTokenExpiresAt: new Date(now.getTime() + (result.expiresInSeconds ?? 0) * 1000),
            liveMode: result.liveMode,
            scope: result.scope,
        },
    });

    logger.info("mercadopago oauth: credenciales renovadas", { organizationId });
    return { refreshed: true };
}

// ==================================================================
// MP-2 — primer caller real de refreshMercadoPagoConnectionTokens (hasta
// esta fase, implementada y probada de forma aislada, sin ningún llamador
// en producción — ver el informe de entrega de MP-1). Resuelve el
// access_token vigente y ya DESENCRIPTADO de la Organization dueña de un
// evento, renovándolo primero si está vencido o a punto de vencer. Nunca
// devuelve nada por fuera de este backend: el caller (mercadoPagoCheckout.
// service.js) lo usa exclusivamente para el header Authorization del
// request server-to-server a Mercado Pago, nunca lo incluye en ninguna
// respuesta HTTP ni lo loguea.
// ==================================================================

const ACCESS_TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

export async function getValidMercadoPagoAccessTokenForOrganization(organizationId) {
    let connection = await prisma.mercadoPagoConnection.findUnique({ where: { organizationId } });
    if (!connection) throw new AppError(ErrorCodes.MERCADOPAGO_NOT_CONNECTED);

    const msUntilExpiry = connection.accessTokenExpiresAt.getTime() - Date.now();
    if (msUntilExpiry < ACCESS_TOKEN_REFRESH_MARGIN_MS) {
        const refreshResult = await refreshMercadoPagoConnectionTokens(organizationId);
        if (!refreshResult.refreshed) {
            throw new AppError(ErrorCodes.MERCADOPAGO_TOKEN_REFRESH_FAILED);
        }
        connection = await prisma.mercadoPagoConnection.findUnique({ where: { organizationId } });
    }

    return decryptMercadoPagoSecret(connection.accessTokenEncrypted);
}
