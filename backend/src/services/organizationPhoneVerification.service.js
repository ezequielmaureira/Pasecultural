import prisma from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { getUserByClerkId } from "../utils/getUserByClerkId.js";
import { buildArgentineWhatsappId } from "../utils/normalizeArgentinePhone.js";
import { generateVerificationCode, hashVerificationCode, verificationCodeMatchesHash } from "../utils/verificationCode.js";
import { generateOrganizationPhoneChallengeToken, hashOrganizationPhoneChallengeToken } from "../utils/organizationPhoneChallengeToken.js";
import { getWhatsappDisplayPhoneNumber } from "./whatsapp.service.js";
import { sendOrganizationPhoneChangeOtpEmail } from "./email/sendOrganizationPhoneChangeOtp.service.js";
import { logger } from "../logging/logger.js";

// Verificación de teléfono/WhatsApp de Organización — UN SOLO mecanismo
// para dos entradas (alta de organización nueva, cambio de un teléfono ya
// verificado): ver el comentario de los modelos en schema.prisma. NUNCA
// OTP por WhatsApp — el organizador nunca prueba nada por un código que
// nosotros mandamos, prueba control real del número respondiendo desde él.
//
// UNIFICACIÓN (ronda "arquitectura final WhatsApp") — Organization.phone
// verificado (phoneVerifiedAt != null) es ahora la ÚNICA fuente de
// identidad de WhatsApp de la organización: sirve simultáneamente como
// contacto público Y como número autorizado para administrar por chatbot.
// Ya no existe un segundo mecanismo paralelo (whatsappNumberChange.service.js
// + WhatsappNumberChangeChallenge, retirados) para "el número autorizado
// del bot" — ver syncWhatsappOrganizerLinkAfterVerification más abajo, que
// sincroniza WhatsappOrganizerLink (la infraestructura real que usa el
// bot para resolver un mensaje entrante, ver whatsappOrganizerDiscovery.service.js)
// automáticamente, en la MISMA transacción que confirma el teléfono —
// nunca un segundo paso manual.
//
// FLUJO INVERTIDO — EL ORGANIZADOR inicia la conversación de WhatsApp: acá
// NUNCA se manda un mensaje de WhatsApp (por eso no hay ningún template de
// Meta involucrado). Lo único que este service produce es un deep link
// wa.me hacia el número oficial de PaseCultural con "CONFIRMAR <token>"
// prearmado — la confirmación real ocurre cuando ESE mensaje llega por el
// webhook real de Meta (ver whatsapp.controller.js) con message.from
// EXACTAMENTE igual a pendingWaId Y el token exacto de esa fila.

const EMAIL_OTP_EXPIRY_MS = 10 * 60 * 1000;
const EMAIL_OTP_MAX_ATTEMPTS = 5;
const EMAIL_OTP_RESEND_COOLDOWN_MS = 60 * 1000;

// Propuesta explícita del pedido: 24 horas.
const WHATSAPP_VERIFICATION_EXPIRY_MS = 24 * 60 * 60 * 1000;
// Cooldown anti-abuso para EMITIR/REEMITIR un token de challenge — ya no
// protege un envío de Meta (no hay ninguno), protege contra spamear
// creación de filas ("Mantener protección contra abuso en creación/
// reinicio de challenges", pedido explícito).
const WHATSAPP_REISSUE_COOLDOWN_MS = 60 * 1000;

// ==================================================================
// Funciones puras — testeables sin Prisma.
// ==================================================================

// Acepta EXACTAMENTE "CONFIRMAR <token>" (mayúsculas/minúsculas y espacios
// al borde/repetidos ignorados) — nunca variantes, nunca sólo "CONFIRMAR"
// sin token (el deep link SIEMPRE prearma el token; sin él no hay forma de
// desambiguar entre organizaciones, ver el comentario del modelo en
// schema.prisma). Devuelve {token} o null — nunca lanza.
const CONFIRMATION_PATTERN = /^CONFIRMAR\s+([A-Z0-9]{6,32})$/;

export function parseOrganizationPhoneConfirmationMessage(rawText) {
    if (typeof rawText !== "string") return null;
    const normalized = rawText.trim().toUpperCase().replace(/\s+/g, " ");
    const match = CONFIRMATION_PATTERN.exec(normalized);
    return match ? { token: match[1] } : null;
}

// Un teléfono candidato requiere autorización previa por email SÓLO si ya
// existe un teléfono verificado que proteger — nunca en el alta de una
// organización nueva, y nunca para (re)verificar un teléfono histórico/
// legacy que todavía no pasó nunca por este mecanismo (phoneVerifiedAt
// null). Es la ÚNICA decisión que distingue "alta nueva" de "cambio": el
// resto del flujo (confirmación por WhatsApp) es idéntico para ambos.
export function requiresEmailAuthorization(organization) {
    return Boolean(organization?.phoneVerifiedAt);
}

// El deep link wa.me que abre WhatsApp del organizador hacia el número
// oficial de PaseCultural con el mensaje prearmado — nunca construido en el
// frontend (que no conoce el número oficial ni el token en texto plano
// antes de que el backend lo emita).
export function buildOrganizationPhoneVerificationDeepLink(officialNumber, token) {
    const text = `CONFIRMAR ${token}`;
    return `https://wa.me/${officialNumber}?text=${encodeURIComponent(text)}`;
}

// ==================================================================
// Autorización — SIEMPRE clerkId (sesión real) + organizationId EXPLÍCITO,
// mismo criterio que el resto de los sub-recursos "/me" del router (ver
// mercadoPagoConnection.service.js#resolveOrganizationForOwnerOrThrow).
// ==================================================================

async function resolveOrganizationForOwnerOrThrow(clerkId, organizationId) {
    if (!organizationId || typeof organizationId !== "string") {
        throw new AppError(ErrorCodes.ORGANIZATION_PHONE_ORGANIZATION_REQUIRED);
    }
    const user = await getUserByClerkId(clerkId);
    if (!user) throw new AppError(ErrorCodes.USER_NOT_FOUND);

    const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (!organization || organization.ownerId !== user.id) {
        // Mismo código tanto si la organización no existe como si existe
        // pero no es del usuario autenticado.
        throw new AppError(ErrorCodes.ORGANIZATION_PHONE_FORBIDDEN);
    }
    return { user, organization };
}

// ==================================================================
// Claim atómico CAS del challenge de WhatsApp — mismo patrón (updateMany
// bajo cooldown, create si no existía, P2002 tratado como "todavía en
// cooldown") que el resto de los flujos de código/challenge de la app
// (scannerInvitation.service.js, whatsappOrganizerLink.service.js). Nunca
// llama a Meta: genera el token acá mismo y devuelve el valor EN TEXTO
// PLANO (sólo existe en este instante — la fila sólo guarda el hash) para
// que el caller arme el deep link. Devuelve `null` si el cooldown todavía
// no pasó.
// ==================================================================

async function claimPhoneVerification({ organizationId, requestedByUserId, pendingPhone, pendingWaId, now }) {
    const cooldownBefore = new Date(now.getTime() - WHATSAPP_REISSUE_COOLDOWN_MS);
    const token = generateOrganizationPhoneChallengeToken();
    const fields = {
        requestedByUserId,
        pendingPhone,
        pendingWaId,
        challengeTokenHash: hashOrganizationPhoneChallengeToken(token),
        expiresAt: new Date(now.getTime() + WHATSAPP_VERIFICATION_EXPIRY_MS),
        lastIssuedAt: now,
    };

    const replaced = await prisma.organizationPhoneVerification.updateMany({
        where: { organizationId, OR: [{ lastIssuedAt: { lt: cooldownBefore } }, { expiresAt: { lt: now } }] },
        data: fields,
    });
    if (replaced.count === 1) return token;

    try {
        await prisma.organizationPhoneVerification.create({ data: { organizationId, ...fields } });
        return token;
    } catch (error) {
        // P2002 acá casi siempre es el cooldown real (organizationId ya
        // tiene una fila viva) — en teoría también podría ser una colisión
        // de challengeTokenHash (token generado dos veces), pero con 32^10
        // combinaciones posibles es efectivamente imposible; tratarla igual
        // (como cooldown) es seguro: el caller simplemente reintenta.
        if (error.code === "P2002") return null;
        throw error;
    }
}

function errorCodeForIssueFailureReason(reason) {
    if (reason === "INVALID_NUMBER") return ErrorCodes.ORGANIZATION_PHONE_INVALID_NUMBER;
    if (reason === "RESEND_TOO_SOON") return ErrorCodes.ORGANIZATION_PHONE_RESEND_TOO_SOON;
    return ErrorCodes.ORGANIZATION_PHONE_SEND_FAILED;
}

// Núcleo compartido: reclama una fila nueva + genera su deep link. NUNCA
// lanza — devuelve {ok:true, deepLink} o {ok:false, reason}; el caller
// decide si eso se traduce en un AppError (llamada explícita del
// organizador) o se degrada silenciosamente a un log (hook best-effort al
// crear una organización ya NO llama a esto, ver la sección más abajo).
async function issuePhoneVerificationChallenge({ organization, user, rawPhone, now }) {
    const pendingWaId = buildArgentineWhatsappId(rawPhone);
    if (!pendingWaId) return { ok: false, reason: "INVALID_NUMBER" };

    // Preflight ANTES de tocar la base: si falta configurar el número
    // oficial, mejor fallar acá que dejar una fila reclamada sin poder
    // devolver nunca su deep link.
    let officialNumber;
    try {
        officialNumber = getWhatsappDisplayPhoneNumber();
    } catch (error) {
        logger.error(error, { context: "issuePhoneVerificationChallenge: falta configuración del número oficial de WhatsApp" });
        return { ok: false, reason: "LINK_UNAVAILABLE" };
    }

    const token = await claimPhoneVerification({
        organizationId: organization.id,
        requestedByUserId: user.id,
        pendingPhone: rawPhone.trim(),
        pendingWaId,
        now,
    });
    if (!token) return { ok: false, reason: "RESEND_TOO_SOON" };

    logger.info("organization phone verification: challenge emitido", { organizationId: organization.id });
    return { ok: true, deepLink: buildOrganizationPhoneVerificationDeepLink(officialNumber, token) };
}

async function claimChangeAuthorization({ organizationId, requestedByUserId, newPhone, now }) {
    const cooldownBefore = new Date(now.getTime() - EMAIL_OTP_RESEND_COOLDOWN_MS);
    const code = generateVerificationCode();
    const fields = {
        requestedByUserId,
        newPhone,
        codeHash: hashVerificationCode(code),
        attempts: 0,
        expiresAt: new Date(now.getTime() + EMAIL_OTP_EXPIRY_MS),
        lastSentAt: now,
    };

    const replaced = await prisma.organizationPhoneChangeAuthorization.updateMany({
        where: { organizationId, OR: [{ lastSentAt: { lt: cooldownBefore } }, { expiresAt: { lt: now } }] },
        data: fields,
    });
    if (replaced.count === 1) return code;

    try {
        await prisma.organizationPhoneChangeAuthorization.create({ data: { organizationId, ...fields } });
        return code;
    } catch (error) {
        if (error.code === "P2002") return null;
        throw error;
    }
}

async function releaseChangeAuthorizationAfterFailedSend(organizationId) {
    await prisma.organizationPhoneChangeAuthorization.deleteMany({ where: { organizationId } }).catch(() => {});
}

// ==================================================================
// Sincronización con WhatsappOrganizerLink — la infraestructura REAL que
// usa el bot para resolver a qué Organization pertenece un mensaje
// entrante (ver whatsappOrganizerDiscovery.service.js#discoverWhatsappOrganizationCandidates,
// que primero reutiliza cualquier WhatsappOrganizerLink ya existente antes
// de volver a mirar Organization.phone). Se llama DENTRO de la misma
// transacción que confirma/borra el teléfono — nunca como un paso
// separado — para que jamás exista una ventana donde el número viejo y el
// nuevo queden autorizados a la vez (sección "cambio de número" del
// pedido): organizationId es @unique en WhatsappOrganizerLink, así que el
// upsert de abajo REEMPLAZA la fila existente (si había una) en el mismo
// UPDATE, nunca crea una segunda.
//
// La limpieza de ConversationState/WhatsappPendingOrganizationSelection
// para el waId VIEJO es el mismo criterio que ya usaba (y ya probaba)
// whatsappNumberChange.service.js#verifyWhatsappNumberChangeService, ahora
// retirado — se preserva acá tal cual: sólo la conversación de ESTA
// organización con el número viejo (un mismo waId puede seguir
// administrando otras Organizations, esas nunca se tocan), y sólo mientras
// siga ACTIVE (nunca revive una ya abandonada/completada).
async function syncWhatsappOrganizerLinkAfterVerification(tx, organizationId, newWaId, now) {
    const existingLink = await tx.whatsappOrganizerLink.findUnique({ where: { organizationId }, select: { waId: true } });
    const oldWaId = existingLink?.waId ?? null;
    if (oldWaId === newWaId) return; // ya estaba sincronizado (ej. reverificación del mismo número) — nada que hacer

    await tx.whatsappOrganizerLink.upsert({
        where: { organizationId },
        update: { waId: newWaId, verifiedAt: now },
        create: { organizationId, waId: newWaId, verifiedAt: now },
    });

    if (oldWaId) {
        await tx.conversationState.updateMany({
            where: { channel: "WHATSAPP", channelRef: oldWaId, organizationId, status: "ACTIVE" },
            data: { status: "ABANDONED" },
        });
        await tx.whatsappPendingOrganizationSelection.deleteMany({ where: { waId: oldWaId } });
    }
    // Limpieza defensiva del lado del número NUEVO también: si por lo que
    // sea ya tenía una selección multi-organización pendiente de una
    // interacción anterior, no debe quedar compitiendo con el vínculo
    // recién sincronizado.
    await tx.whatsappPendingOrganizationSelection.deleteMany({ where: { waId: newWaId } });
}

// Revoca por completo la autorización de chatbot de una organización —
// usada por deleteOrganizationPhoneService. A diferencia del sync de
// arriba (que REEMPLAZA el link), acá se BORRA: sin teléfono verificado no
// hay ningún número que deba quedar autorizado. Misma limpieza de
// ConversationState/selección pendiente que arriba, para el único waId
// que sí importa acá (el que se está revocando).
async function revokeWhatsappOrganizerLink(tx, organizationId) {
    const existingLink = await tx.whatsappOrganizerLink.findUnique({ where: { organizationId }, select: { waId: true } });
    if (!existingLink) return;

    await tx.whatsappOrganizerLink.deleteMany({ where: { organizationId } });
    await tx.conversationState.updateMany({
        where: { channel: "WHATSAPP", channelRef: existingLink.waId, organizationId, status: "ACTIVE" },
        data: { status: "ABANDONED" },
    });
    await tx.whatsappPendingOrganizationSelection.deleteMany({ where: { waId: existingLink.waId } });
}

// ==================================================================
// REQUEST — POST .../phone-verification/request. Punto de entrada único
// para "verificar por primera vez" y "cambiar" — la decisión de si hace
// falta el email OTP se toma acá, mirando el estado REAL de la
// organización (requiresEmailAuthorization), nunca un flag que mande el
// cliente.
// ==================================================================

export async function requestOrganizationPhoneVerificationService(clerkId, organizationId, rawPhone) {
    const { user, organization } = await resolveOrganizationForOwnerOrThrow(clerkId, organizationId);

    const newWaId = buildArgentineWhatsappId(rawPhone);
    if (!newWaId) throw new AppError(ErrorCodes.ORGANIZATION_PHONE_INVALID_NUMBER);

    const currentWaId = organization.phoneVerifiedAt ? buildArgentineWhatsappId(organization.phone) : null;
    if (currentWaId && currentWaId === newWaId) {
        throw new AppError(ErrorCodes.ORGANIZATION_PHONE_SAME_NUMBER);
    }

    const now = new Date();

    if (requiresEmailAuthorization(organization)) {
        // CAMBIO de un teléfono ya verificado — PASO 1: autorizar por email
        // ANTES de habilitar el deep link de WhatsApp. El teléfono actual
        // sigue intacto.
        const code = await claimChangeAuthorization({ organizationId: organization.id, requestedByUserId: user.id, newPhone: rawPhone.trim(), now });
        if (!code) throw new AppError(ErrorCodes.ORGANIZATION_PHONE_RESEND_TOO_SOON);

        try {
            await sendOrganizationPhoneChangeOtpEmail({ to: organization.email, code, organizationName: organization.name });
        } catch (error) {
            await releaseChangeAuthorizationAfterFailedSend(organization.id);
            logger.warn("organization phone change: fallo al enviar el OTP por email", { organizationId: organization.id, reason: error.message });
            throw new AppError(ErrorCodes.ORGANIZATION_PHONE_EMAIL_SEND_FAILED);
        }

        logger.info("organization phone change: OTP enviado por email", { organizationId: organization.id });
        return { step: "EMAIL_OTP_REQUIRED" };
    }

    // Alta nueva, o teléfono histórico/legacy nunca verificado — directo al
    // deep link de WhatsApp, sin OTP (no hay ningún canal ya probado que
    // proteger).
    const result = await issuePhoneVerificationChallenge({ organization, user, rawPhone, now });
    if (!result.ok) throw new AppError(errorCodeForIssueFailureReason(result.reason));
    return { step: "WHATSAPP_PENDING", deepLink: result.deepLink };
}

// ==================================================================
// EMAIL OTP VERIFY — POST .../phone-verification/email-otp/verify. Código
// correcto habilita recién ENTONCES el deep link de WhatsApp del número
// candidato.
// ==================================================================

export async function verifyOrganizationPhoneChangeOtpService(clerkId, organizationId, rawCode) {
    const { user, organization } = await resolveOrganizationForOwnerOrThrow(clerkId, organizationId);

    const code = String(rawCode ?? "").trim();
    if (!/^\d{6}$/.test(code)) throw new AppError(ErrorCodes.ORGANIZATION_PHONE_OTP_CODE_REQUIRED);

    const now = new Date();
    const authorization = await prisma.organizationPhoneChangeAuthorization.findUnique({ where: { organizationId: organization.id } });
    if (!authorization) throw new AppError(ErrorCodes.ORGANIZATION_PHONE_OTP_NOT_FOUND);
    if (authorization.expiresAt < now) throw new AppError(ErrorCodes.ORGANIZATION_PHONE_OTP_CODE_EXPIRED);
    if (authorization.requestedByUserId !== user.id) throw new AppError(ErrorCodes.ORGANIZATION_PHONE_FORBIDDEN);
    if (authorization.attempts >= EMAIL_OTP_MAX_ATTEMPTS) throw new AppError(ErrorCodes.ORGANIZATION_PHONE_OTP_TOO_MANY_ATTEMPTS);

    if (!verificationCodeMatchesHash(code, authorization.codeHash)) {
        await prisma.organizationPhoneChangeAuthorization.updateMany({ where: { id: authorization.id }, data: { attempts: { increment: 1 } } });
        throw new AppError(ErrorCodes.ORGANIZATION_PHONE_OTP_CODE_INVALID);
    }

    // Reclamo atómico (delete): dos VERIFY concurrentes con el mismo
    // código nunca autorizan dos veces — mismo mecanismo que
    // confirmOrganizationPhoneFromWebhook más abajo (deleteMany por id
    // dentro de la transacción).
    const claim = await prisma.organizationPhoneChangeAuthorization.deleteMany({ where: { id: authorization.id } });
    if (claim.count === 0) throw new AppError(ErrorCodes.ORGANIZATION_PHONE_OTP_ALREADY_RESOLVED);

    const result = await issuePhoneVerificationChallenge({ organization, user, rawPhone: authorization.newPhone, now });
    if (!result.ok) throw new AppError(errorCodeForIssueFailureReason(result.reason));
    return { step: "WHATSAPP_PENDING", deepLink: result.deepLink };
}

// ==================================================================
// "Abrir WhatsApp nuevamente" — POST .../phone-verification/whatsapp/resend.
// Ya NO reenvía nada por Meta (PaseCultural nunca mandó un WhatsApp para
// empezar): reemite un deep link nuevo para el intento YA en curso, mismo
// pendingPhone/pendingWaId, sujeto al mismo cooldown anti-abuso que la
// emisión inicial. Existe para cuando el organizador perdió el link
// original (recargó la página, cerró la pestaña) — mientras lo tenga a
// mano, el frontend puede reabrirlo directo sin llamar acá.
// ==================================================================

export async function resendOrganizationPhoneWhatsappService(clerkId, organizationId) {
    const { organization } = await resolveOrganizationForOwnerOrThrow(clerkId, organizationId);
    const now = new Date();

    const existing = await prisma.organizationPhoneVerification.findUnique({ where: { organizationId: organization.id } });
    if (!existing || existing.expiresAt < now) throw new AppError(ErrorCodes.ORGANIZATION_PHONE_VERIFICATION_NOT_FOUND);

    let officialNumber;
    try {
        officialNumber = getWhatsappDisplayPhoneNumber();
    } catch (error) {
        logger.error(error, { context: "resendOrganizationPhoneWhatsappService: falta configuración del número oficial de WhatsApp" });
        throw new AppError(ErrorCodes.ORGANIZATION_PHONE_SEND_FAILED);
    }

    const token = await claimPhoneVerification({
        organizationId: organization.id,
        requestedByUserId: existing.requestedByUserId,
        pendingPhone: existing.pendingPhone,
        pendingWaId: existing.pendingWaId,
        now,
    });
    if (!token) throw new AppError(ErrorCodes.ORGANIZATION_PHONE_RESEND_TOO_SOON);

    logger.info("organization phone verification: deep link reemitido", { organizationId: organization.id });
    return { step: "WHATSAPP_PENDING", deepLink: buildOrganizationPhoneVerificationDeepLink(officialNumber, token) };
}

export async function resendOrganizationPhoneChangeOtpService(clerkId, organizationId) {
    const { organization } = await resolveOrganizationForOwnerOrThrow(clerkId, organizationId);
    const now = new Date();

    const existing = await prisma.organizationPhoneChangeAuthorization.findUnique({ where: { organizationId: organization.id } });
    if (!existing || existing.expiresAt < now) throw new AppError(ErrorCodes.ORGANIZATION_PHONE_OTP_NOT_FOUND);

    const code = await claimChangeAuthorization({ organizationId: organization.id, requestedByUserId: existing.requestedByUserId, newPhone: existing.newPhone, now });
    if (!code) throw new AppError(ErrorCodes.ORGANIZATION_PHONE_RESEND_TOO_SOON);

    try {
        await sendOrganizationPhoneChangeOtpEmail({ to: organization.email, code, organizationName: organization.name });
    } catch (error) {
        await releaseChangeAuthorizationAfterFailedSend(organization.id);
        logger.warn("organization phone change: fallo al reenviar el OTP por email", { organizationId: organization.id, reason: error.message });
        throw new AppError(ErrorCodes.ORGANIZATION_PHONE_EMAIL_SEND_FAILED);
    }

    logger.info("organization phone change: OTP reenviado por email", { organizationId: organization.id });
    return { step: "EMAIL_OTP_REQUIRED" };
}

// ==================================================================
// CANCEL — POST .../phone-verification/cancel. Descarta cualquier intento
// EN CURSO (autorización por email y/o challenge de WhatsApp) — nunca
// toca Organization.phone/phoneVerifiedAt. Idempotente (deleteMany sobre 0
// o 1 filas, nunca lanza).
// ==================================================================

export async function cancelOrganizationPhoneChangeService(clerkId, organizationId) {
    const { organization } = await resolveOrganizationForOwnerOrThrow(clerkId, organizationId);
    await prisma.organizationPhoneChangeAuthorization.deleteMany({ where: { organizationId: organization.id } });
    await prisma.organizationPhoneVerification.deleteMany({ where: { organizationId: organization.id } });
    logger.info("organization phone verification: cancelado", { organizationId: organization.id });
    return { cancelled: true };
}

// ==================================================================
// DELETE — POST .../phone-verification/delete. Sirve para AMBOS casos que
// pide el Dashboard ("Eliminar número" sobre un teléfono nunca verificado,
// y "Eliminar WhatsApp de contacto" sobre uno ya verificado): la mutación
// real es idéntica en los dos — nunca hubo lógica de negocio distinta que
// justifique dos endpoints, sólo distinta UX en el frontend (confirmación
// visual antes de llamar acá cuando el teléfono YA estaba verificado, ver
// el informe de entrega). Transaccional (misma unidad atómica que
// confirmOrganizationPhoneFromWebhook) — si un CONFIRMAR concurrente ya
// commiteó primero, esto simplemente vuelve a poner todo en null sobre el
// teléfono recién verificado (delete explícito de un teléfono verificado,
// caso legítimo); si esto commitea primero, el CONFIRMAR que llegue
// después no encuentra ninguna fila para reclamar y no hace nada — el
// lock de fila de Postgres sobre el UPDATE de Organization alcanza para
// serializar ambos casos sin lógica extra. Idempotente: llamarlo con
// Organization.phone ya en null no falla, sólo no cambia nada más.
// ==================================================================

export async function deleteOrganizationPhoneService(clerkId, organizationId) {
    const { organization } = await resolveOrganizationForOwnerOrThrow(clerkId, organizationId);

    await prisma.$transaction(async (tx) => {
        await tx.organization.update({
            where: { id: organization.id },
            data: { phone: null, phoneVerifiedAt: null },
        });
        // Invalida CUALQUIER challenge/autorización en curso — nunca debe
        // quedar un pendingPhone/token fantasma apuntando a una
        // Organization que ya no tiene teléfono. No es un no-op silencioso
        // que se pueda saltar: un OrganizationPhoneVerification vivo acá
        // es exactamente el "CONFIRMAR <token>" viejo que la sección 8 del
        // pedido exige inutilizar de inmediato.
        await tx.organizationPhoneChangeAuthorization.deleteMany({ where: { organizationId: organization.id } });
        await tx.organizationPhoneVerification.deleteMany({ where: { organizationId: organization.id } });
        // Revoca de inmediato la autorización de chatbot asociada — el
        // número eliminado no puede seguir administrando la organización
        // por WhatsApp (ver el informe de entrega, sección "eliminar").
        await revokeWhatsappOrganizerLink(tx, organization.id);
    });

    logger.info("organization phone verification: teléfono eliminado", { organizationId: organization.id });
    return { deleted: true };
}

// ==================================================================
// STATUS — GET .../phone-verification. Sólo lectura. Nunca devuelve el
// deep link/token (sólo existió en texto plano en la respuesta del
// request/verify/resend que lo emitió — la fila sólo guarda el hash): el
// frontend guarda ese deep link en memoria, y si lo pierde (recarga de
// página) usa "Abrir WhatsApp nuevamente" para pedir uno nuevo.
// ==================================================================

export async function getOrganizationPhoneStatusService(clerkId, organizationId) {
    const { organization } = await resolveOrganizationForOwnerOrThrow(clerkId, organizationId);
    const now = new Date();

    const [authorization, verification] = await Promise.all([
        prisma.organizationPhoneChangeAuthorization.findUnique({ where: { organizationId: organization.id }, select: { expiresAt: true } }),
        prisma.organizationPhoneVerification.findUnique({ where: { organizationId: organization.id }, select: { pendingPhone: true, expiresAt: true } }),
    ]);

    const hasPendingWhatsapp = Boolean(verification) && verification.expiresAt >= now;

    return {
        phone: organization.phone,
        verifiedAt: organization.phoneVerifiedAt,
        emailOtpPending: Boolean(authorization) && authorization.expiresAt >= now,
        pendingPhone: hasPendingWhatsapp ? verification.pendingPhone : null,
        pendingExpiresAt: hasPendingWhatsapp ? verification.expiresAt : null,
    };
}

// ==================================================================
// CONFIRMACIÓN — llamada ÚNICAMENTE desde whatsapp.controller.js, a partir
// de un mensaje "CONFIRMAR <token>" ya recibido por el webhook real de
// Meta (ver parseOrganizationPhoneConfirmationMessage). `waId` es SIEMPRE
// message.from tal cual lo manda Meta — nunca un valor que decida el
// frontend.
//
// DESAMBIGUACIÓN (sección crítica del pedido) — el lookup es por
// challengeTokenHash, @unique GLOBAL: nunca puede haber dos filas vivas
// (de cualquier organización) con el mismo token, así que encontrar una
// fila por token YA identifica una única organización sin ambigüedad
// posible, sin importar que pendingWaId no sea único. `message.from` se
// exige IGUAL como segundo factor (nunca sólo el token) — evita que un
// token filtrado/copiado se pueda confirmar desde un número distinto al
// que efectivamente se está verificando.
//
// Idempotente por diseño: el `deleteMany` que reclama la fila es lo único
// que la consume, así que una reentrega/duplicado del mismo "CONFIRMAR
// <token>" nunca puede aplicar el cambio dos veces — la segunda vez,
// simplemente no encuentra ninguna fila para ese token (ya se borró).
// ==================================================================

export async function confirmOrganizationPhoneFromWebhook({ waId, token }) {
    if (typeof waId !== "string" || !waId || typeof token !== "string" || !token) {
        return { confirmed: false, organizationId: null };
    }

    const now = new Date();
    const candidate = await prisma.organizationPhoneVerification.findUnique({
        where: { challengeTokenHash: hashOrganizationPhoneChallengeToken(token) },
    });
    if (!candidate) return { confirmed: false, organizationId: null };
    if (candidate.expiresAt < now) return { confirmed: false, organizationId: null };
    if (candidate.pendingWaId !== waId) return { confirmed: false, organizationId: null };

    try {
        const confirmed = await prisma.$transaction(async (tx) => {
            const claim = await tx.organizationPhoneVerification.deleteMany({ where: { id: candidate.id } });
            if (claim.count === 0) return false; // otra confirmación concurrente ya lo consumió
            await tx.organization.update({
                where: { id: candidate.organizationId },
                data: { phone: candidate.pendingPhone, phoneVerifiedAt: now },
            });
            // Unificación — el mismo número recién verificado queda
            // simultáneamente autorizado para administrar por chatbot,
            // atómico con la confirmación de arriba (ver el comentario de
            // la función).
            await syncWhatsappOrganizerLinkAfterVerification(tx, candidate.organizationId, waId, now);
            return true;
        });
        if (!confirmed) return { confirmed: false, organizationId: null };

        logger.info("confirmOrganizationPhoneFromWebhook: teléfono verificado", { organizationId: candidate.organizationId });
        return { confirmed: true, organizationId: candidate.organizationId };
    } catch (error) {
        logger.error(error, {
            context: "confirmOrganizationPhoneFromWebhook: fallo inesperado confirmando la organización",
            organizationId: candidate.organizationId,
        });
        return { confirmed: false, organizationId: null };
    }
}
