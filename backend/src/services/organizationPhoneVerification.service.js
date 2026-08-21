import prisma from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { getUserByClerkId } from "../utils/getUserByClerkId.js";
import { buildArgentineWhatsappId } from "../utils/normalizeArgentinePhone.js";
import { generateVerificationCode, hashVerificationCode, verificationCodeMatchesHash } from "../utils/verificationCode.js";
import { sendWhatsappPhoneVerificationTemplate } from "./whatsapp.service.js";
import { sendOrganizationPhoneChangeOtpEmail } from "./email/sendOrganizationPhoneChangeOtp.service.js";
import { logger } from "../logging/logger.js";

// Verificación de teléfono/WhatsApp de Organización — UN SOLO mecanismo
// para dos entradas (alta de organización nueva, cambio de un teléfono ya
// verificado): ver el comentario de los modelos en schema.prisma. NUNCA
// OTP por WhatsApp (a diferencia de whatsappNumberChange.service.js, que
// es un dominio completamente distinto — el número AUTORIZADO para
// administrar por el bot, nunca Organization.phone) — la confirmación acá
// es siempre "responder CONFIRMAR desde el número nuevo", capturada por el
// webhook real de Meta (ver whatsapp.controller.js).

const EMAIL_OTP_EXPIRY_MS = 10 * 60 * 1000;
const EMAIL_OTP_MAX_ATTEMPTS = 5;
const EMAIL_OTP_RESEND_COOLDOWN_MS = 60 * 1000;

// Propuesta explícita del pedido: 24 horas.
const WHATSAPP_VERIFICATION_EXPIRY_MS = 24 * 60 * 60 * 1000;
const WHATSAPP_RESEND_COOLDOWN_MS = 60 * 1000;

// ==================================================================
// Funciones puras — testeables sin Prisma.
// ==================================================================

// "CONFIRMAR" — ignora mayúsculas/minúsculas y tolera espacios (incluidos
// espacios repetidos/al borde), pero NUNCA acepta variantes ("confirmar
// por favor", "si, confirmo"): sólo la palabra exacta, normalizada.
export function isOrganizationPhoneConfirmationText(rawText) {
    if (typeof rawText !== "string") return false;
    const normalized = rawText.trim().toUpperCase().replace(/\s+/g, " ");
    return normalized === "CONFIRMAR";
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

// ==================================================================
// Autorización — SIEMPRE clerkId (sesión real) + organizationId EXPLÍCITO,
// mismo criterio que whatsappNumberChange.service.js (duplicado a
// propósito, no importado desde ahí: dominios distintos).
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
// Claims atómicos CAS — mismo patrón (updateMany bajo cooldown, create si
// no existía, P2002 tratado como "todavía en cooldown") que
// whatsappNumberChange.service.js#claimNumberChangeChallenge.
// ==================================================================

async function claimPhoneVerification({ organizationId, requestedByUserId, pendingPhone, pendingWaId, now }) {
    const cooldownBefore = new Date(now.getTime() - WHATSAPP_RESEND_COOLDOWN_MS);
    const fields = {
        requestedByUserId,
        pendingPhone,
        pendingWaId,
        expiresAt: new Date(now.getTime() + WHATSAPP_VERIFICATION_EXPIRY_MS),
        lastSentAt: now,
    };

    const replaced = await prisma.organizationPhoneVerification.updateMany({
        where: { organizationId, OR: [{ lastSentAt: { lt: cooldownBefore } }, { expiresAt: { lt: now } }] },
        data: fields,
    });
    if (replaced.count === 1) return true;

    try {
        await prisma.organizationPhoneVerification.create({ data: { organizationId, ...fields } });
        return true;
    } catch (error) {
        if (error.code === "P2002") return false;
        throw error;
    }
}

// Si el envío por Meta falla DESPUÉS de reclamar, no queda nada útil que
// conservar (el mensaje nunca llegó) — se borra la fila entera, mismo
// criterio que whatsappNumberChange.service.js#releaseAfterFailedSend.
async function releasePhoneVerificationAfterFailedSend(organizationId) {
    await prisma.organizationPhoneVerification.deleteMany({ where: { organizationId } }).catch(() => {});
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

function errorCodeForSendFailureReason(reason) {
    if (reason === "INVALID_NUMBER") return ErrorCodes.ORGANIZATION_PHONE_INVALID_NUMBER;
    if (reason === "RESEND_TOO_SOON") return ErrorCodes.ORGANIZATION_PHONE_RESEND_TOO_SOON;
    return ErrorCodes.ORGANIZATION_PHONE_SEND_FAILED;
}

// Núcleo compartido: reclama + manda el mensaje de WhatsApp. NUNCA lanza —
// devuelve {ok:true} o {ok:false, reason}; el caller decide si eso se
// traduce en un AppError (llamada explícita del organizador) o se degrada
// silenciosamente a un log (hook best-effort al crear una organización).
async function attemptWhatsappPhoneVerificationSend({ organization, user, rawPhone, now }) {
    const pendingWaId = buildArgentineWhatsappId(rawPhone);
    if (!pendingWaId) return { ok: false, reason: "INVALID_NUMBER" };

    const claimed = await claimPhoneVerification({
        organizationId: organization.id,
        requestedByUserId: user.id,
        pendingPhone: rawPhone.trim(),
        pendingWaId,
        now,
    });
    if (!claimed) return { ok: false, reason: "RESEND_TOO_SOON" };

    const sendResult = await sendWhatsappPhoneVerificationTemplate({ to: pendingWaId, organizationName: organization.name }).catch((error) => ({
        success: false,
        error: error.message,
    }));
    if (!sendResult.success) {
        await releasePhoneVerificationAfterFailedSend(organization.id);
        logger.warn("organization phone verification: fallo al enviar el mensaje de WhatsApp", { organizationId: organization.id, reason: sendResult.error });
        return { ok: false, reason: "SEND_FAILED" };
    }

    logger.info("organization phone verification: mensaje de WhatsApp enviado", { organizationId: organization.id });
    return { ok: true };
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
        // ANTES de tocar WhatsApp. El teléfono actual sigue intacto.
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

    // Alta nueva, o teléfono histórico/legacy nunca verificado — directo a
    // WhatsApp, sin OTP (no hay ningún canal ya probado que proteger).
    const result = await attemptWhatsappPhoneVerificationSend({ organization, user, rawPhone, now });
    if (!result.ok) throw new AppError(errorCodeForSendFailureReason(result.reason));
    return { step: "WHATSAPP_SENT" };
}

// ==================================================================
// EMAIL OTP VERIFY — POST .../phone-verification/email-otp/verify. PASO 4
// y 5: código correcto autoriza recién ENTONCES el envío del WhatsApp.
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
    // whatsappNumberChange.service.js#verifyWhatsappNumberChangeService.
    const claim = await prisma.organizationPhoneChangeAuthorization.deleteMany({ where: { id: authorization.id } });
    if (claim.count === 0) throw new AppError(ErrorCodes.ORGANIZATION_PHONE_OTP_ALREADY_RESOLVED);

    const result = await attemptWhatsappPhoneVerificationSend({ organization, user, rawPhone: authorization.newPhone, now });
    if (!result.ok) throw new AppError(errorCodeForSendFailureReason(result.reason));
    return { step: "WHATSAPP_SENT" };
}

// ==================================================================
// RESEND — reenvío del mensaje de WhatsApp (verificación ya en curso) o
// del OTP por email (autorización de cambio ya en curso). Con rate limit
// (cooldown CAS), mismo criterio que el resto de la app.
// ==================================================================

export async function resendOrganizationPhoneWhatsappService(clerkId, organizationId) {
    const { organization } = await resolveOrganizationForOwnerOrThrow(clerkId, organizationId);
    const now = new Date();

    const existing = await prisma.organizationPhoneVerification.findUnique({ where: { organizationId: organization.id } });
    if (!existing || existing.expiresAt < now) throw new AppError(ErrorCodes.ORGANIZATION_PHONE_VERIFICATION_NOT_FOUND);

    const claimed = await claimPhoneVerification({
        organizationId: organization.id,
        requestedByUserId: existing.requestedByUserId,
        pendingPhone: existing.pendingPhone,
        pendingWaId: existing.pendingWaId,
        now,
    });
    if (!claimed) throw new AppError(ErrorCodes.ORGANIZATION_PHONE_RESEND_TOO_SOON);

    const sendResult = await sendWhatsappPhoneVerificationTemplate({ to: existing.pendingWaId, organizationName: organization.name }).catch((error) => ({
        success: false,
        error: error.message,
    }));
    if (!sendResult.success) {
        await releasePhoneVerificationAfterFailedSend(organization.id);
        logger.warn("organization phone verification: fallo al reenviar el mensaje de WhatsApp", { organizationId: organization.id, reason: sendResult.error });
        throw new AppError(ErrorCodes.ORGANIZATION_PHONE_SEND_FAILED);
    }

    logger.info("organization phone verification: mensaje de WhatsApp reenviado", { organizationId: organization.id });
    return { step: "WHATSAPP_SENT" };
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
// EN CURSO (autorización por email y/o verificación de WhatsApp) — nunca
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
// STATUS — GET .../phone-verification. Sólo lectura.
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
// Hook best-effort al crear una organización nueva (organization.service.js)
// — NUNCA lanza: la organización ya quedó creada, la falta de
// confirmación de WhatsApp no puede revertir ni bloquear eso.
// ==================================================================

export async function startOrganizationPhoneVerificationOnCreate(organization, user) {
    if (!organization.phone) return;
    try {
        const result = await attemptWhatsappPhoneVerificationSend({ organization, user, rawPhone: organization.phone, now: new Date() });
        if (!result.ok) {
            logger.warn("startOrganizationPhoneVerificationOnCreate: no se pudo iniciar la verificación de WhatsApp (la organización ya quedó creada igual)", {
                organizationId: organization.id,
                reason: result.reason,
            });
        }
    } catch (error) {
        logger.error(error, {
            context: "startOrganizationPhoneVerificationOnCreate: fallo inesperado (no afecta la organización ya creada)",
            organizationId: organization.id,
        });
    }
}

// ==================================================================
// CONFIRMACIÓN — llamada ÚNICAMENTE desde whatsapp.controller.js, a partir
// de un mensaje "CONFIRMAR" ya recibido por el webhook real de Meta (ver
// isOrganizationPhoneConfirmationText). `waId` es SIEMPRE message.from tal
// cual lo manda Meta — nunca un valor que decida el frontend.
//
// pendingWaId NO es único (dos organizaciones distintas pueden estar
// verificando el mismo número al mismo tiempo, ver el comentario del
// modelo) — se confirman TODAS las candidatas encontradas, cada una en su
// propia transacción atómica. La transición es idempotente por diseño: el
// `deleteMany` que reclama cada fila es lo único que la consume, así que
// una reentrega/duplicado del mismo "CONFIRMAR" (o dos "CONFIRMAR"
// separados, con wamids distintos) nunca puede aplicar el cambio dos
// veces — la segunda vez, simplemente no encuentra ninguna fila PENDING
// para ese wa_id.
// ==================================================================

export async function confirmOrganizationPhoneFromWebhook(waId) {
    if (typeof waId !== "string" || !waId) return { confirmedOrganizationIds: [] };

    const now = new Date();
    const candidates = await prisma.organizationPhoneVerification.findMany({
        where: { pendingWaId: waId, expiresAt: { gt: now } },
    });
    if (candidates.length === 0) return { confirmedOrganizationIds: [] };

    const confirmedOrganizationIds = [];
    for (const candidate of candidates) {
        try {
            const confirmed = await prisma.$transaction(async (tx) => {
                const claim = await tx.organizationPhoneVerification.deleteMany({ where: { id: candidate.id } });
                if (claim.count === 0) return false; // otra confirmación concurrente ya lo consumió
                await tx.organization.update({
                    where: { id: candidate.organizationId },
                    data: { phone: candidate.pendingPhone, phoneVerifiedAt: now },
                });
                return true;
            });
            if (confirmed) confirmedOrganizationIds.push(candidate.organizationId);
        } catch (error) {
            logger.error(error, {
                context: "confirmOrganizationPhoneFromWebhook: fallo inesperado confirmando una organización puntual (las demás candidatas siguen procesándose)",
                organizationId: candidate.organizationId,
            });
        }
    }

    if (confirmedOrganizationIds.length > 0) {
        logger.info("confirmOrganizationPhoneFromWebhook: teléfono verificado", { count: confirmedOrganizationIds.length });
    }
    return { confirmedOrganizationIds };
}
