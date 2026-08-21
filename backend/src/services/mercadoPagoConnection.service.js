import crypto from "node:crypto";
import prisma from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { getUserByClerkId } from "../utils/getUserByClerkId.js";
import { encryptMercadoPagoSecret, decryptMercadoPagoSecret } from "../config/mercadoPagoEncryption.js";
import { buildMercadoPagoAuthorizationUrl, exchangeMercadoPagoAuthorizationCode, refreshMercadoPagoAccessToken } from "./mercadoPago.service.js";
import { logger } from "../logging/logger.js";
import { sendDeveloperAlert, DeveloperAlertType } from "./email/sendDeveloperAlert.service.js";

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
// Bug fix (desconexión de Mercado Pago) — advisory lock por Organization,
// mismo mecanismo que acquireTicketTypeFunctionLock (functionCapacity.
// service.js, MP-2.1): serializa ÚNICAMENTE los intentos de
// conectar/desconectar que compiten por la MISMA Organization, nunca
// bloquea otra Organization. Es lo único que garantiza "a lo sumo una fila
// ACTIVE por Organization" ahora que organizationId dejó de ser @unique —
// sin esto, dos callbacks OAuth concurrentes (o un connect y un disconnect
// concurrentes) podrían dejar dos filas ACTIVE al mismo tiempo. DEBE
// tomarse dentro de la MISMA transacción que hace el resto del trabajo
// (`tx`, nunca `prisma` directo) — se libera solo al terminar esa
// transacción (commit o rollback).
// ==================================================================

async function acquireMercadoPagoConnectionLock(tx, organizationId) {
    await tx.$queryRawUnsafe(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text AS locked`,
        `mercado_pago_connection:${organizationId}`
    );
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

    const connection = await prisma.mercadoPagoConnection.findFirst({
        where: { organizationId: organization.id, status: "ACTIVE" },
        select: { connectedAt: true, liveMode: true, mercadoPagoUserId: true },
    });

    return {
        connected: Boolean(connection),
        connectedAt: connection?.connectedAt ?? null,
        liveMode: connection?.liveMode ?? null,
        // Bug fix (identificar la cuenta conectada) — no es secreto (es un
        // id de cuenta, no una credencial): permite al organizador
        // confirmar que la cuenta vinculada es la correcta sin tener que
        // consultar la base de datos.
        mercadoPagoUserId: connection?.mercadoPagoUserId ?? null,
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

    // Bug fix (desconexión de Mercado Pago) — ya NO se hace upsert sobre
    // una fila existente: eso sobreescribía en el lugar los tokens/
    // mercadoPagoUserId de una conexión anterior, dejando irresoluble
    // cualquier webhook tardío de un payment cobrado con la cuenta vieja
    // (ver el comentario del modelo en schema.prisma). Ahora, dentro de UNA
    // transacción bajo advisory lock (serializa sólo esta Organization):
    // 1) cualquier fila ACTIVE existente pasa a DISCONNECTED (se conserva,
    //    nunca se borra ni se pisa); 2) se crea una fila NUEVA, ACTIVE, con
    //    los tokens de la cuenta recién autorizada. Cubre tanto la primera
    //    conexión (0 filas ACTIVE para desactivar) como una reconexión.
    // Alertas Developer — "primera conexión histórica" vs. "reconexión":
    // se determina ACÁ, contando filas EXISTENTES (cualquier status, no
    // sólo ACTIVE) para esta Organization ANTES de crear la nueva, dentro
    // de la MISMA transacción bajo el advisory lock de arriba — no hace
    // falta ningún campo/migración nuevo (ver informe de entrega, sección
    // "Primera conexión MP"). Concurrent-safe por construcción: dos
    // callbacks concurrentes para la MISMA Organization ya están
    // serializados por acquireMercadoPagoConnectionLock, así que sólo uno
    // de los dos puede ver `priorConnectionsCount === 0`.
    let isFirstConnectionEver = false;
    await prisma.$transaction(async (tx) => {
        await acquireMercadoPagoConnectionLock(tx, organizationId);
        const priorConnectionsCount = await tx.mercadoPagoConnection.count({ where: { organizationId } });
        isFirstConnectionEver = priorConnectionsCount === 0;

        await tx.mercadoPagoConnection.updateMany({
            where: { organizationId, status: "ACTIVE" },
            data: { status: "DISCONNECTED", disconnectedAt: now },
        });
        await tx.mercadoPagoConnection.create({
            data: {
                organizationId,
                mercadoPagoUserId: exchange.mercadoPagoUserId,
                publicKey: exchange.publicKey,
                accessTokenEncrypted: encryptMercadoPagoSecret(exchange.accessToken),
                refreshTokenEncrypted: encryptMercadoPagoSecret(exchange.refreshToken),
                scope: exchange.scope,
                liveMode: exchange.liveMode,
                accessTokenExpiresAt,
                status: "ACTIVE",
            },
        });
    });

    logger.info("mercadopago oauth: conexión persistida", { organizationId, isFirstConnectionEver });

    if (isFirstConnectionEver) {
        // Nunca dentro de la transacción de arriba (ya cerrada): Resend es
        // una llamada de red externa. Fetch aparte, sólo para el nombre en
        // el email — si esto fallara, la alerta simplemente no sale (ver
        // sendDeveloperAlert, siempre best-effort), nunca rompe el OAuth
        // ya persistido.
        try {
            const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
            const alertResult = await sendDeveloperAlert(DeveloperAlertType.MERCADOPAGO_FIRST_CONNECTION, {
                organizationId,
                organizationName: organization?.name ?? organizationId,
                connectedAt: now,
            });
            if (!alertResult.sent) {
                logger.warn("mercadopago oauth: no se pudo enviar la alerta Developer de primera conexión", { organizationId, reason: alertResult.reason });
            }
        } catch (err) {
            logger.error(err, { context: "mercadopago oauth: fallo inesperado al intentar mandar la alerta Developer de primera conexión (no afecta la conexión ya persistida)", organizationId });
        }
    }

    return { organizationId };
}

// ==================================================================
// Bug fix (desconexión de Mercado Pago) — DISCONNECT, GET/POST
// .../mercadopago/disconnect. Nunca borra la fila (ver el comentario del
// modelo): sólo la marca DISCONNECTED, bajo el mismo advisory lock que el
// callback, para que dos disconnects concurrentes (o un disconnect
// concurrente con una reconexión) nunca dejen un estado inconsistente.
// Idempotente por diseño: si ya no había ninguna fila ACTIVE, `updateMany`
// afecta 0 filas y la operación igual termina en éxito — desconectar algo
// que ya está desconectado nunca es un error.
// ==================================================================

export async function disconnectMercadoPagoConnectionService(clerkId, organizationId) {
    const { organization } = await resolveOrganizationForOwnerOrThrow(clerkId, organizationId);
    const now = new Date();

    const { updateResult, activeConnectionId } = await prisma.$transaction(async (tx) => {
        await acquireMercadoPagoConnectionLock(tx, organization.id);
        // Se resuelve ANTES del update sólo para poder incluir el id en la
        // alerta Developer — nunca cambia qué fila se desconecta ni el
        // resultado en sí.
        const active = await tx.mercadoPagoConnection.findFirst({ where: { organizationId: organization.id, status: "ACTIVE" }, select: { id: true } });
        const updateResult = await tx.mercadoPagoConnection.updateMany({
            where: { organizationId: organization.id, status: "ACTIVE" },
            data: { status: "DISCONNECTED", disconnectedAt: now },
        });
        return { updateResult, activeConnectionId: active?.id ?? null };
    });

    logger.info("mercadopago oauth: conexión desconectada", { organizationId: organization.id, hadActiveConnection: updateResult.count > 0 });

    // Alertas Developer — sólo si de verdad HABÍA una conexión ACTIVE para
    // desconectar (idempotente: desconectar algo ya desconectado nunca
    // dispara esto, ver el comentario de arriba). Best-effort, nunca lanza.
    if (updateResult.count > 0) {
        const alertResult = await sendDeveloperAlert(DeveloperAlertType.MERCADOPAGO_DISCONNECTED, {
            organizationId: organization.id,
            organizationName: organization.name,
            connectionId: activeConnectionId,
            disconnectedAt: now,
        });
        if (!alertResult.sent) {
            logger.warn("disconnectMercadoPagoConnectionService: no se pudo enviar la alerta Developer de desconexión", { organizationId: organization.id, reason: alertResult.reason });
        }
    }

    return { disconnected: true };
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

// Núcleo compartido: renueva UNA fila ya resuelta (por organización ACTIVE
// o por id puntual, ver los dos wrappers de abajo) y persiste por `id`
// (nunca por organizationId, que ya no identifica una fila única). Bug fix
// (desconexión de Mercado Pago): extraído para que un webhook tardío
// pueda renovar el access_token de una conexión YA DISCONNECTED (sigue
// siendo un token legítimo de esa cuenta, sólo que ya no es la conexión
// activa de la Organization) sin que eso la reactive ni la confunda con
// la conexión ACTIVE actual.
async function refreshConnectionRow(connection) {
    const refreshToken = decryptMercadoPagoSecret(connection.refreshTokenEncrypted);
    const result = await refreshMercadoPagoAccessToken(refreshToken).catch((error) => ({ success: false, error: error.message }));
    if (!result.success) {
        logger.warn("mercadopago oauth: fallo al renovar credenciales", { connectionId: connection.id, organizationId: connection.organizationId, reason: result.error });
        return { refreshed: false, reason: result.error };
    }

    const now = new Date();
    await prisma.mercadoPagoConnection.update({
        where: { id: connection.id },
        data: {
            accessTokenEncrypted: encryptMercadoPagoSecret(result.accessToken),
            refreshTokenEncrypted: encryptMercadoPagoSecret(result.refreshToken),
            accessTokenExpiresAt: new Date(now.getTime() + (result.expiresInSeconds ?? 0) * 1000),
            liveMode: result.liveMode,
            scope: result.scope,
        },
    });

    logger.info("mercadopago oauth: credenciales renovadas", { connectionId: connection.id, organizationId: connection.organizationId });
    return { refreshed: true };
}

export async function refreshMercadoPagoConnectionTokens(organizationId) {
    const connection = await prisma.mercadoPagoConnection.findFirst({ where: { organizationId, status: "ACTIVE" } });
    if (!connection) return { refreshed: false, reason: "NOT_CONNECTED" };
    return refreshConnectionRow(connection);
}

// Bug fix (desconexión de Mercado Pago) — mismo mecanismo que arriba, pero
// por `connectionId` puntual en vez de "la conexión ACTIVE de la
// Organization": lo usa mercadoPagoWebhook.service.js para renovar la
// MISMA fila que ya resolvió (que puede ser una conexión DISCONNECTED, si
// el webhook llegó tarde), nunca la conexión ACTIVE actual de la
// Organization (que podría ya ser de otra cuenta).
export async function refreshMercadoPagoConnectionTokensById(connectionId) {
    const connection = await prisma.mercadoPagoConnection.findUnique({ where: { id: connectionId } });
    if (!connection) return { refreshed: false, reason: "NOT_CONNECTED" };
    return refreshConnectionRow(connection);
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
    let connection = await prisma.mercadoPagoConnection.findFirst({ where: { organizationId, status: "ACTIVE" } });
    if (!connection) throw new AppError(ErrorCodes.MERCADOPAGO_NOT_CONNECTED);

    const msUntilExpiry = connection.accessTokenExpiresAt.getTime() - Date.now();
    if (msUntilExpiry < ACCESS_TOKEN_REFRESH_MARGIN_MS) {
        const refreshResult = await refreshMercadoPagoConnectionTokens(organizationId);
        if (!refreshResult.refreshed) {
            throw new AppError(ErrorCodes.MERCADOPAGO_TOKEN_REFRESH_FAILED);
        }
        connection = await prisma.mercadoPagoConnection.findFirst({ where: { organizationId, status: "ACTIVE" } });
    }

    return decryptMercadoPagoSecret(connection.accessTokenEncrypted);
}

// Bug fix (desconexión de Mercado Pago) — variante para
// mercadoPagoWebhook.service.js: resuelve el access_token vigente de una
// fila PUNTUAL ya identificada (por id, sin importar su status ACTIVE/
// DISCONNECTED), nunca "la conexión ACTIVE actual de la Organization". Es
// la pieza que cierra el escenario "cuenta A → desconectar → conectar
// cuenta B → llega tarde el webhook del payment de A": el webhook ya
// resolvió cuál fila corresponde a A (por mercadoPagoUserId, ver
// mercadoPagoWebhook.service.js) — usar acá
// getValidMercadoPagoAccessTokenForOrganization en su lugar habría vuelto
// a resolver "la ACTIVE de esa Organization", que para ese momento ya
// podría ser la cuenta B, y el pago de A se hubiera intentado consultar
// con el token de B (o directamente hubiera fallado con
// MERCADOPAGO_NOT_CONNECTED si B nunca se conectó).
export async function getValidMercadoPagoAccessTokenForConnection(connectionId) {
    let connection = await prisma.mercadoPagoConnection.findUnique({ where: { id: connectionId } });
    if (!connection) throw new AppError(ErrorCodes.MERCADOPAGO_NOT_CONNECTED);

    const msUntilExpiry = connection.accessTokenExpiresAt.getTime() - Date.now();
    if (msUntilExpiry < ACCESS_TOKEN_REFRESH_MARGIN_MS) {
        const refreshResult = await refreshMercadoPagoConnectionTokensById(connectionId);
        if (!refreshResult.refreshed) {
            throw new AppError(ErrorCodes.MERCADOPAGO_TOKEN_REFRESH_FAILED);
        }
        connection = await prisma.mercadoPagoConnection.findUnique({ where: { id: connectionId } });
    }

    return decryptMercadoPagoSecret(connection.accessTokenEncrypted);
}
