import prisma from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { getUserByClerkId } from "../utils/getUserByClerkId.js";
import { buildArgentineWhatsappId } from "../utils/normalizeArgentinePhone.js";
import { generateVerificationCode, hashVerificationCode, verificationCodeMatchesHash } from "../utils/verificationCode.js";
import { sendWhatsappOtpTemplate, sendWhatsappWelcomeTemplate } from "./whatsapp.service.js";
import { logger } from "../logging/logger.js";

// Cambio SEGURO del número de WhatsApp autorizado para administrar una
// organización — nunca Organization.phone (el teléfono público/de
// contacto, campo de texto libre sin verificar). El número autorizado
// real vive en WhatsappOrganizerLink.waId; este archivo es el único que
// puede reescribirlo por este camino (el otro camino, legacy y hoy
// inalcanzable en la práctica, es whatsappOrganizerLink.service.js —
// Fase 2F, vinculación INICIAL por código enviado DESDE WhatsApp; este
// flujo es el opuesto: disparado DESDE la Web, código enviado AL nuevo
// WhatsApp).
//
// Mismos parámetros que el resto de los flujos de código de 6 dígitos de
// la app (scannerInvitation, saleRecoveryVerification, el propio
// whatsappOrganizerLink.service.js): 10 minutos de vigencia, 5 intentos,
// 1 minuto de cooldown entre reenvíos.
const CODE_EXPIRY_MS = 10 * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000;

// ==================================================================
// Funciones puras — testeables sin Prisma, mismo criterio que
// whatsappOrganizerLink.service.js#evaluateWhatsappLinkChallengeLookup.
// ==================================================================

export function evaluateNumberChangeChallengeLookup({ challenge, now }) {
    if (!challenge) return { status: "NOT_FOUND" };
    if (challenge.expiresAt < now) return { status: "EXPIRED" };
    return { status: "VALID" };
}

export function evaluateNumberChangeAttempts({ attempts, maxAttempts = MAX_VERIFY_ATTEMPTS }) {
    return { blocked: attempts >= maxAttempts };
}

// Decide si corresponde generar un código nuevo o si hay que esperar
// (challenge todavía vigente y dentro del cooldown de reenvío) — mismo
// criterio que whatsappOrganizerLink.service.js#shouldCreateNewChallenge.
export function shouldSendNewNumberChangeCode({ existing, now, cooldownMs = RESEND_COOLDOWN_MS }) {
    if (!existing) return true;
    if (existing.expiresAt < now) return true;
    return now.getTime() - existing.lastSentAt.getTime() >= cooldownMs;
}

// ==================================================================
// Autorización — SIEMPRE clerkId (sesión real) + organizationId EXPLÍCITO
// (nunca inferido con findFirst, a diferencia del flujo legacy de Fase 2F):
// un usuario que administra más de una Organization sólo puede tocar la
// que el caller pasó, y sólo si realmente le pertenece.
// ==================================================================

async function resolveOrganizationForOwnerOrThrow(clerkId, organizationId) {
    if (!organizationId || typeof organizationId !== "string") {
        throw new AppError(ErrorCodes.WHATSAPP_NUMBER_CHANGE_ORGANIZATION_REQUIRED);
    }

    const user = await getUserByClerkId(clerkId);
    if (!user) throw new AppError(ErrorCodes.USER_NOT_FOUND);

    const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (!organization || organization.ownerId !== user.id) {
        // Deliberadamente el MISMO código tanto si la organización no
        // existe como si existe pero no es del usuario autenticado — nunca
        // se revela cuál de los dos casos ocurrió.
        throw new AppError(ErrorCodes.WHATSAPP_NUMBER_CHANGE_FORBIDDEN);
    }

    return { user, organization };
}

// ==================================================================
// Claim atómico del challenge — mismo patrón CAS (updateMany bajo
// cooldown, create si no existía, P2002 tratado como "pending") que
// whatsappOrganizerLink.service.js#claimChallengeReplacement y
// scannerInvitation.service.js#claimVerificationCodeSend.
// ==================================================================

async function claimNumberChangeChallenge({ organizationId, requestedByUserId, oldWaId, newWaId, now }) {
    const cooldownBefore = new Date(now.getTime() - RESEND_COOLDOWN_MS);
    const code = generateVerificationCode();
    const fields = {
        requestedByUserId,
        oldWaId,
        newWaId,
        codeHash: hashVerificationCode(code),
        attempts: 0,
        expiresAt: new Date(now.getTime() + CODE_EXPIRY_MS),
        lastSentAt: now,
    };

    const replaced = await prisma.whatsappNumberChangeChallenge.updateMany({
        where: {
            organizationId,
            OR: [{ lastSentAt: { lt: cooldownBefore } }, { expiresAt: { lt: now } }],
        },
        data: fields,
    });
    if (replaced.count === 1) return code;

    try {
        await prisma.whatsappNumberChangeChallenge.create({ data: { organizationId, ...fields } });
        return code;
    } catch (error) {
        if (error.code === "P2002") return null; // ya hay uno vigente Y en cooldown
        throw error;
    }
}

// Si el envío por Meta falla DESPUÉS de haber reclamado el challenge, no
// queda nada útil que conservar (el código nunca llegó) — se borra la fila
// entera en vez de "liberar sólo el cooldown" (a diferencia de
// scannerInvitation.service.js, acá la fila ENTERA representa "hay un
// código válido esperando", nunca una entidad persistente por su cuenta).
async function releaseAfterFailedSend(organizationId, newWaId) {
    await prisma.whatsappNumberChangeChallenge.deleteMany({ where: { organizationId, newWaId } }).catch(() => {});
}

// ==================================================================
// REQUEST — POST .../whatsapp-number/change/request
// ==================================================================

export async function requestWhatsappNumberChangeService(clerkId, organizationId, rawPhone) {
    const { user, organization } = await resolveOrganizationForOwnerOrThrow(clerkId, organizationId);

    const newWaId = buildArgentineWhatsappId(rawPhone);
    if (!newWaId) throw new AppError(ErrorCodes.WHATSAPP_NUMBER_CHANGE_INVALID_NUMBER);

    const existingLink = await prisma.whatsappOrganizerLink.findUnique({ where: { organizationId: organization.id } });
    const oldWaId = existingLink?.waId ?? null;

    if (oldWaId === newWaId) {
        throw new AppError(ErrorCodes.WHATSAPP_NUMBER_CHANGE_SAME_NUMBER);
    }

    const now = new Date();
    const code = await claimNumberChangeChallenge({ organizationId: organization.id, requestedByUserId: user.id, oldWaId, newWaId, now });
    if (!code) {
        throw new AppError(ErrorCodes.WHATSAPP_NUMBER_CHANGE_RESEND_TOO_SOON);
    }

    // El código NUNCA se loguea; sólo el resultado de éxito/fracaso del
    // envío (mismo criterio que sendBotReply en whatsapp.controller.js).
    const sendResult = await sendWhatsappOtpTemplate({ to: newWaId, code }).catch((error) => ({ success: false, error: error.message }));
    if (!sendResult.success) {
        await releaseAfterFailedSend(organization.id, newWaId);
        logger.warn("whatsapp number change: fallo al enviar el código", { organizationId: organization.id, reason: sendResult.error });
        throw new AppError(ErrorCodes.WHATSAPP_NUMBER_CHANGE_SEND_FAILED);
    }

    logger.info("whatsapp number change: código enviado", { organizationId: organization.id });
    return { sent: true };
}

// ==================================================================
// RESEND — POST .../whatsapp-number/change/resend
// ==================================================================

export async function resendWhatsappNumberChangeOtpService(clerkId, organizationId) {
    const { organization } = await resolveOrganizationForOwnerOrThrow(clerkId, organizationId);
    const now = new Date();

    const existing = await prisma.whatsappNumberChangeChallenge.findUnique({ where: { organizationId: organization.id } });
    const lookup = evaluateNumberChangeChallengeLookup({ challenge: existing, now });
    if (lookup.status !== "VALID") {
        throw new AppError(ErrorCodes.WHATSAPP_NUMBER_CHANGE_NOT_FOUND);
    }

    const code = await claimNumberChangeChallenge({
        organizationId: organization.id,
        requestedByUserId: existing.requestedByUserId,
        oldWaId: existing.oldWaId,
        newWaId: existing.newWaId,
        now,
    });
    if (!code) throw new AppError(ErrorCodes.WHATSAPP_NUMBER_CHANGE_RESEND_TOO_SOON);

    const sendResult = await sendWhatsappOtpTemplate({ to: existing.newWaId, code }).catch((error) => ({ success: false, error: error.message }));
    if (!sendResult.success) {
        await releaseAfterFailedSend(organization.id, existing.newWaId);
        logger.warn("whatsapp number change: fallo al reenviar el código", { organizationId: organization.id, reason: sendResult.error });
        throw new AppError(ErrorCodes.WHATSAPP_NUMBER_CHANGE_SEND_FAILED);
    }

    logger.info("whatsapp number change: código reenviado", { organizationId: organization.id });
    return { sent: true };
}

// ==================================================================
// CANCEL — POST .../whatsapp-number/change/cancel
// ==================================================================

// Idempotente (deleteMany sobre 0 o 1 filas, nunca lanza) — nunca toca
// WhatsappOrganizerLink: cancelar sólo descarta el INTENTO en curso, jamás
// el vínculo ya verificado.
export async function cancelWhatsappNumberChangeService(clerkId, organizationId) {
    const { organization } = await resolveOrganizationForOwnerOrThrow(clerkId, organizationId);
    await prisma.whatsappNumberChangeChallenge.deleteMany({ where: { organizationId: organization.id } });
    logger.info("whatsapp number change: cancelado", { organizationId: organization.id });
    return { cancelled: true };
}

// ==================================================================
// VERIFY — POST .../whatsapp-number/change/verify — el único punto que
// efectivamente migra WhatsappOrganizerLink.
// ==================================================================

export async function verifyWhatsappNumberChangeService(clerkId, organizationId, rawCode) {
    const { user, organization } = await resolveOrganizationForOwnerOrThrow(clerkId, organizationId);

    const code = String(rawCode ?? "").trim();
    if (!/^\d{6}$/.test(code)) throw new AppError(ErrorCodes.WHATSAPP_NUMBER_CHANGE_CODE_REQUIRED);

    const now = new Date();
    const challenge = await prisma.whatsappNumberChangeChallenge.findUnique({ where: { organizationId: organization.id } });

    const lookup = evaluateNumberChangeChallengeLookup({ challenge, now });
    if (lookup.status === "NOT_FOUND") throw new AppError(ErrorCodes.WHATSAPP_NUMBER_CHANGE_NOT_FOUND);
    if (lookup.status === "EXPIRED") throw new AppError(ErrorCodes.WHATSAPP_NUMBER_CHANGE_CODE_EXPIRED);

    // Reconfirmación explícita de identidad/organización antes de migrar —
    // organization.id ya viene garantizado por el findUnique de arriba
    // (es la clave de búsqueda), pero requestedByUserId se revalida igual
    // por las dudas (defensa en profundidad, costo cero: ya está en
    // memoria) — un challenge nunca debe poder resolverse para un usuario
    // distinto del que lo pidió, aunque hoy la propiedad de la
    // organización ya lo garantice indirectamente.
    if (challenge.requestedByUserId !== user.id) {
        throw new AppError(ErrorCodes.WHATSAPP_NUMBER_CHANGE_FORBIDDEN);
    }

    const { blocked } = evaluateNumberChangeAttempts({ attempts: challenge.attempts });
    if (blocked) throw new AppError(ErrorCodes.WHATSAPP_NUMBER_CHANGE_TOO_MANY_ATTEMPTS);

    if (!verificationCodeMatchesHash(code, challenge.codeHash)) {
        await prisma.whatsappNumberChangeChallenge.updateMany({
            where: { id: challenge.id },
            data: { attempts: { increment: 1 } },
        });
        throw new AppError(ErrorCodes.WHATSAPP_NUMBER_CHANGE_CODE_INVALID);
    }

    // ---- Migración atómica: todo o nada, ver informe de entrega. -------
    //
    // El "reclamo" (deleteMany por id, DENTRO de la misma transacción que
    // el resto) es lo que hace que dos VERIFY concurrentes con el mismo
    // código nunca migren dos veces: sólo uno de los dos puede borrar
    // realmente esta fila (Postgres serializa el DELETE por fila bajo el
    // lock de la transacción) — el que pierde ve count===0 y aborta sin
    // tocar WhatsappOrganizerLink/ConversationState/nada más. Mismo
    // mecanismo, mismo razonamiento, que
    // whatsappInboundMessageClaim.service.js#claimInboundMessage.
    const migrated = await prisma.$transaction(async (tx) => {
        const claim = await tx.whatsappNumberChangeChallenge.deleteMany({ where: { id: challenge.id } });
        if (claim.count === 0) return null;

        // organizationId es @unique en WhatsappOrganizerLink: a lo sumo una
        // fila por organización — upsert cubre tanto "primera vinculación"
        // (oldWaId null) como "reemplazo del número ya vinculado" en la
        // MISMA operación, sin un delete+create separado (nunca el
        // escenario "link viejo borrado -> error -> link nuevo nunca
        // creado" que el pedido pidió evitar explícitamente).
        await tx.whatsappOrganizerLink.upsert({
            where: { organizationId: organization.id },
            update: { waId: challenge.newWaId, verifiedAt: now },
            create: { organizationId: organization.id, waId: challenge.newWaId, verifiedAt: now },
        });

        if (challenge.oldWaId) {
            // Sólo la conversación de ESTA organización con el número
            // viejo — un mismo waId puede administrar otras Organizations
            // (Fase 2G), y esas nunca deben verse afectadas (filtro
            // explícito por organizationId, nunca sólo por channelRef).
            await tx.conversationState.updateMany({
                where: { channel: "WHATSAPP", channelRef: challenge.oldWaId, organizationId: organization.id, status: "ACTIVE" },
                data: { status: "ABANDONED" },
            });
            // Selección multi-organización pendiente del número viejo (si
            // justo estaba a mitad de elegir entre varias Organizations) —
            // ya no tiene sentido conservarla asociada a un número que
            // dejó de administrar ESTA organización.
            await tx.whatsappPendingOrganizationSelection.deleteMany({ where: { waId: challenge.oldWaId } });
        }
        // Limpieza defensiva del lado del número NUEVO también: si por lo
        // que sea ya tenía una selección pendiente de una interacción
        // anterior (ej. alguien empezó a escribirle al bot antes de
        // completar esta migración), no debe quedar compitiendo con el
        // vínculo recién creado.
        await tx.whatsappPendingOrganizationSelection.deleteMany({ where: { waId: challenge.newWaId } });

        return { newWaId: challenge.newWaId };
    });

    if (!migrated) {
        // Otra verificación concurrente ya consumió este challenge (doble
        // click, dos pestañas, reintento de red) — nunca se migra dos
        // veces ni se revela si "ya se había resuelto con éxito" o
        // "alguien más lo canceló en el medio": mismo código para ambos.
        throw new AppError(ErrorCodes.WHATSAPP_NUMBER_CHANGE_ALREADY_RESOLVED);
    }

    logger.info("whatsapp number change: migración completa", { organizationId: organization.id });

    // Mensaje de bienvenida — SIEMPRE después de que la transacción ya
    // confirmó (nunca I/O externo dentro de una transacción de DB), y
    // SIEMPRE best-effort: la migración ya está confirmada y no se
    // revierte porque este mensaje falle o la plantilla no esté
    // configurada todavía.
    sendWhatsappWelcomeTemplate({ to: migrated.newWaId, firstName: user.firstName ?? "", organizationName: organization.name })
        .then((result) => {
            if (!result.success) {
                logger.warn("whatsapp number change: no se pudo enviar el mensaje de bienvenida", {
                    organizationId: organization.id,
                    reason: result.error,
                });
            }
        })
        .catch((error) => {
            logger.warn("whatsapp number change: no se pudo enviar el mensaje de bienvenida", {
                organizationId: organization.id,
                reason: error.message,
            });
        });

    return { migrated: true, organizationName: organization.name };
}

// ==================================================================
// STATUS — GET .../whatsapp-number — sólo lectura, nunca expone el waId
// completo del challenge en curso (si lo hay), sólo si hay uno pendiente.
// ==================================================================

export async function getWhatsappNumberChangeStatusService(clerkId, organizationId) {
    const { organization } = await resolveOrganizationForOwnerOrThrow(clerkId, organizationId);

    const link = await prisma.whatsappOrganizerLink.findUnique({
        where: { organizationId: organization.id },
        select: { waId: true, verifiedAt: true },
    });

    const now = new Date();
    const challenge = await prisma.whatsappNumberChangeChallenge.findUnique({
        where: { organizationId: organization.id },
        select: { expiresAt: true },
    });
    const hasPendingChange = Boolean(challenge) && challenge.expiresAt >= now;

    return {
        waId: link?.waId ?? null,
        verifiedAt: link?.verifiedAt ?? null,
        hasPendingChange,
    };
}
