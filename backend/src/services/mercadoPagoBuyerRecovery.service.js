import prisma from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { isValidEmail } from "../utils/validateEmail.js";
import { normalizeBuyerDocument, isValidBuyerDocument } from "../utils/validateBuyerDocument.js";
import { maskEmail } from "../utils/maskEmail.js";
import { generateVerificationCode, hashVerificationCode, verificationCodeMatchesHash } from "../utils/verificationCode.js";
import { sendSalePaymentRecoveryVerificationCodeEmail } from "./email/sendSalePaymentRecoveryVerificationCode.service.js";
import { resendConfirmationEmailByTokenService } from "./sale.service.js";
import { getValidMercadoPagoAccessTokenForConnection } from "./mercadoPagoConnection.service.js";
import { getMercadoPagoPayment } from "./mercadoPago.service.js";
import { confirmMercadoPagoPaymentIfEligible } from "./mercadoPagoPaymentConfirmation.service.js";
import { listCandidateConnectionsForOrganization } from "./mercadoPagoReconciliation.service.js";
import { logger } from "../logging/logger.js";

// "Pagué pero no recibí mis entradas" — segunda opción de la pantalla
// pública "Recuperar mis entradas" (RecoverPurchase.jsx), ronda
// "recuperación de pagos" (parte 2). Mismo modelo de dos pasos que
// saleRecoveryVerification.service.js (email+DNI localizan, un código OTP
// autoriza) — deliberadamente NO se reusa ese archivo tal cual: acá,
// "localizar" también implica un tercer dato (paymentId) que NUNCA se
// persiste entre los dos pasos (ver el comentario de
// SalePaymentRecoveryVerification en schema.prisma) y la verificación real
// contra Mercado Pago ocurre RECIÉN después del OTP correcto (nunca antes —
// ver resolvePendingOrConfirmedSaleByPayment).
//
// Cero lógica financiera propia: toda la validación económica/confirmación
// pasa por confirmMercadoPagoPaymentIfEligible (mercadoPagoPaymentConfirmation.
// service.js), el mismo núcleo que ya usan el webhook y la reconciliación
// Developer.

const CODE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutos — mismo criterio que saleRecoveryVerification.service.js
const MAX_VERIFICATION_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000;

// Límites de trabajo por solicitud (pedido explícito de esta ronda) — nunca
// una cantidad ilimitada de consultas externas a Mercado Pago por request.
const MAX_CANDIDATE_SALES = 10;
const MAX_CONNECTIONS_PER_ORGANIZATION = 3;

function normalizeAndValidateRecoveryIdentity(email, buyerDocument) {
    const normalizedEmail = email?.trim().toLowerCase();
    if (!normalizedEmail || !buyerDocument?.trim()) {
        throw new AppError(ErrorCodes.RECOVER_INFO_REQUIRED);
    }
    if (!isValidEmail(normalizedEmail)) {
        throw new AppError(ErrorCodes.GUEST_BUYER_INVALID_EMAIL);
    }
    const normalizedDocument = normalizeBuyerDocument(buyerDocument);
    if (!isValidBuyerDocument(normalizedDocument)) {
        throw new AppError(ErrorCodes.GUEST_BUYER_INVALID_DOCUMENT);
    }
    return { normalizedEmail, normalizedDocument };
}

// Chequeo barato, SIN tocar Mercado Pago — sólo decide si vale la pena
// mandar un código. PENDING o CONFIRMED: la primera es el caso a reconciliar,
// la segunda es el caso idempotente (reenvío). Nunca revela nada por sí solo
// — el resultado de este chequeo nunca vuelve al comprador.
async function hasAnyMercadoPagoRecoveryCandidate(normalizedEmail, normalizedDocument) {
    const sale = await prisma.sale.findFirst({
        where: {
            paymentMethod: "MERCADO_PAGO",
            deletedAt: null,
            buyerDocument: normalizedDocument,
            buyer: { email: normalizedEmail },
            status: { in: ["PENDING", "CONFIRMED"] },
        },
        select: { id: true },
    });
    return Boolean(sale);
}

// Reclamo atómico de UN envío de código — mismo mecanismo exacto que
// claimSaleRecoveryVerificationCodeSend (saleRecoveryVerification.service.js),
// sobre la tabla propia SalePaymentRecoveryVerification.
async function claimPaymentRecoveryVerificationCodeSend(normalizedEmail, normalizedDocument) {
    const now = new Date();
    const cooldownBefore = new Date(now.getTime() - RESEND_COOLDOWN_MS);
    const code = generateVerificationCode();
    const codeFields = {
        codeHash: hashVerificationCode(code),
        codeExpiresAt: new Date(now.getTime() + CODE_EXPIRY_MS),
        attempts: 0,
        lastSentAt: now,
    };

    const updated = await prisma.salePaymentRecoveryVerification.updateMany({
        where: {
            normalizedEmail,
            normalizedDocument,
            OR: [{ lastSentAt: null }, { lastSentAt: { lt: cooldownBefore } }],
        },
        data: codeFields,
    });
    if (updated.count === 1) return code;

    try {
        await prisma.salePaymentRecoveryVerification.create({
            data: { normalizedEmail, normalizedDocument, ...codeFields },
        });
        return code;
    } catch (err) {
        if (err.code === "P2002") return null; // cooldown activo
        throw err;
    }
}

async function releaseCooldownAfterFailedSend(normalizedEmail, normalizedDocument) {
    await prisma.salePaymentRecoveryVerification
        .updateMany({ where: { normalizedEmail, normalizedDocument }, data: { lastSentAt: null } })
        .catch(() => {});
}

async function claimAndSendIfMatch(normalizedEmail, normalizedDocument, logLabel) {
    const hasCandidate = await hasAnyMercadoPagoRecoveryCandidate(normalizedEmail, normalizedDocument);
    if (!hasCandidate) {
        logger.info(`${logLabel}: sin compras coincidentes`, { matchCount: 0 });
        return;
    }

    const code = await claimPaymentRecoveryVerificationCodeSend(normalizedEmail, normalizedDocument);
    if (!code) {
        logger.info(`${logLabel}: cooldown de reenvío activo`);
        return;
    }
    try {
        await sendSalePaymentRecoveryVerificationCodeEmail({ to: normalizedEmail, code });
        logger.info(`${logLabel}: código enviado`);
    } catch (err) {
        await releaseCooldownAfterFailedSend(normalizedEmail, normalizedDocument);
        logger.error(`${logLabel}: no se pudo enviar el código`, { errorName: err?.name || "Error" });
    }
}

// Paso 1 — igual que requestSaleRecoveryCodeService: siempre responde lo
// mismo exista o no una compra real detrás.
export const requestPaymentRecoveryCodeService = async ({ email, buyerDocument }) => {
    const { normalizedEmail, normalizedDocument } = normalizeAndValidateRecoveryIdentity(email, buyerDocument);
    await claimAndSendIfMatch(normalizedEmail, normalizedDocument, "requestPaymentRecoveryCodeService");
    return { maskedEmail: maskEmail(normalizedEmail) };
};

export const resendPaymentRecoveryCodeService = async ({ email, buyerDocument }) => {
    const { normalizedEmail, normalizedDocument } = normalizeAndValidateRecoveryIdentity(email, buyerDocument);
    await claimAndSendIfMatch(normalizedEmail, normalizedDocument, "resendPaymentRecoveryCodeService");
    return { maskedEmail: maskEmail(normalizedEmail) };
};

// El corazón del flujo — SOLO se llama después de un OTP verificado
// correctamente (ver verifyPaymentRecoveryCodeService más abajo). Nunca se
// llama antes: hasta acá, nada de esto tocó Mercado Pago ni reveló que
// existe una compra o un pago aprobado (pedido explícito de esta ronda).
async function resolvePendingOrConfirmedSaleByPayment({ normalizedEmail, normalizedDocument, normalizedPaymentId }) {
    const candidates = await prisma.sale.findMany({
        where: {
            paymentMethod: "MERCADO_PAGO",
            deletedAt: null,
            buyerDocument: normalizedDocument,
            buyer: { email: normalizedEmail },
            status: { in: ["PENDING", "CONFIRMED"] },
        },
        select: {
            id: true,
            status: true,
            mercadoPagoExternalReference: true,
            mercadoPagoPaymentId: true,
            publicRecoveryToken: true,
            event: { select: { organizationId: true } },
        },
        take: MAX_CANDIDATE_SALES,
        orderBy: { createdAt: "desc" },
    });

    if (candidates.length === 0) {
        logger.info("mercadopago buyer recovery: sin Sales candidatas", { matchCount: 0 });
        return { matched: false };
    }

    // 1) CONFIRMED — caso idempotente: SOLO reenvía si el paymentId ya
    // verificado coincide EXACTO con el que la Sale ya tiene guardado (nunca
    // se vuelve a golpear Mercado Pago para esto — ya se verificó al
    // confirmar). Un paymentId distinto NUNCA autoriza un reenvío.
    const confirmedMatch = candidates.find((c) => c.status === "CONFIRMED" && c.mercadoPagoPaymentId === normalizedPaymentId);
    if (confirmedMatch) {
        await resendConfirmationEmailByTokenService(confirmedMatch.publicRecoveryToken);
        logger.info("mercadopago buyer recovery: Sale ya CONFIRMED con el mismo paymentId, reenviado", { saleId: confirmedMatch.id });
        return { matched: true, recoveryToken: confirmedMatch.publicRecoveryToken };
    }

    // 2) PENDING — descubrimiento acotado. Conexiones dedupeadas por
    // organización (nunca se resuelven dos veces para la misma org dentro de
    // la misma solicitud) y recortadas a MAX_CONNECTIONS_PER_ORGANIZATION.
    const pendingCandidates = candidates.filter((c) => c.status === "PENDING");
    const connectionsByOrganization = new Map();
    let hadTransientFailure = false;

    for (const candidate of pendingCandidates) {
        const organizationId = candidate.event.organizationId;
        if (!connectionsByOrganization.has(organizationId)) {
            const connections = await listCandidateConnectionsForOrganization(organizationId);
            connectionsByOrganization.set(organizationId, connections.slice(0, MAX_CONNECTIONS_PER_ORGANIZATION));
        }

        for (const connection of connectionsByOrganization.get(organizationId)) {
            let accessToken;
            try {
                accessToken = await getValidMercadoPagoAccessTokenForConnection(connection.id);
            } catch (error) {
                logger.warn("mercadopago buyer recovery: no se pudo obtener credencial para intentar verificar el pago", {
                    saleId: candidate.id,
                    connectionId: connection.id,
                    reason: error?.code ?? error?.message ?? "UNKNOWN",
                });
                continue;
            }

            const payment = await getMercadoPagoPayment({ accessToken, paymentId: normalizedPaymentId });
            if (!payment.success) {
                if (payment.error === "TIMEOUT" || payment.error === "NETWORK_ERROR") hadTransientFailure = true;
                continue;
            }

            // Chequeo clave (pedido explícito de esta ronda): el payment
            // tiene que pertenecer EXACTAMENTE a ESTA candidata puntual —
            // mercadoPagoExternalReference es @unique en Sale, así que nunca
            // puede haber una segunda candidata que matchee el mismo
            // payment. Se verifica ACÁ, antes de delegar al núcleo
            // compartido: nunca se deja que confirmMercadoPagoPaymentIfEligible
            // resuelva "a qué Sale pertenece" por su cuenta a partir de un
            // paymentId que un desconocido pudo haber adivinado — eso podría
            // terminar confirmando la compra de otra persona.
            if (payment.externalReference !== candidate.mercadoPagoExternalReference) continue;

            const outcome = await confirmMercadoPagoPaymentIfEligible({
                paymentId: normalizedPaymentId,
                candidateConnectionId: connection.id,
                source: "BUYER_RECOVERY",
            });

            if (outcome.action === "confirmed" || outcome.action === "already_confirmed") {
                logger.info("mercadopago buyer recovery: Sale recuperada", { saleId: candidate.id, action: outcome.action });
                return { matched: true, recoveryToken: candidate.publicRecoveryToken };
            }
            if (outcome.action === "approved_but_no_stock") {
                logger.error(new Error("mercadopago buyer recovery: payment approved sin stock disponible al confirmar"), {
                    saleId: candidate.id,
                });
                return { matched: "pending_review" };
            }
            if (outcome.ok === false) {
                // transient_error del núcleo compartido — falla real de
                // infraestructura, nunca un dato que simplemente no coincide.
                hadTransientFailure = true;
                continue;
            }
            logger.info("mercadopago buyer recovery: candidato descartado por el núcleo compartido de validación", {
                saleId: candidate.id,
                action: outcome.action,
                reason: outcome.reason,
            });
        }
    }

    if (hadTransientFailure) {
        throw new AppError(ErrorCodes.MERCADOPAGO_RECOVERY_CHECK_FAILED);
    }

    logger.info("mercadopago buyer recovery: ningún candidato coincidió", { candidateCount: candidates.length });
    return { matched: false };
}

// Paso 2 — mismo mecanismo de verificación OTP que verifySaleRecoveryCodeService
// (sesión por normalizedEmail+normalizedDocument, hash en tiempo constante,
// vencimiento, límite de intentos, un solo uso), sobre la tabla propia. Sólo
// DESPUÉS de un código correcto se llega a tocar Mercado Pago o a revelar
// nada de una compra real.
export const verifyPaymentRecoveryCodeService = async ({ email, buyerDocument, code, paymentId }) => {
    const { normalizedEmail, normalizedDocument } = normalizeAndValidateRecoveryIdentity(email, buyerDocument);

    const submittedCode = String(code ?? "").trim();
    if (!submittedCode) throw new AppError(ErrorCodes.RECOVER_VERIFICATION_CODE_REQUIRED);

    const normalizedPaymentId = String(paymentId ?? "").trim();
    if (!normalizedPaymentId) throw new AppError(ErrorCodes.BUYER_PAYMENT_RECOVERY_PAYMENT_ID_REQUIRED);

    const session = await prisma.salePaymentRecoveryVerification.findUnique({
        where: { normalizedEmail_normalizedDocument: { normalizedEmail, normalizedDocument } },
    });

    // "Nunca pediste un código" y "código incorrecto" tienen que verse
    // exactamente igual desde afuera — mismo criterio que el flujo existente.
    if (!session) throw new AppError(ErrorCodes.RECOVER_VERIFICATION_CODE_INVALID);
    if (session.codeExpiresAt && session.codeExpiresAt < new Date()) {
        throw new AppError(ErrorCodes.RECOVER_VERIFICATION_CODE_EXPIRED);
    }
    if (session.attempts >= MAX_VERIFICATION_ATTEMPTS) {
        throw new AppError(ErrorCodes.RECOVER_VERIFICATION_TOO_MANY_ATTEMPTS);
    }
    if (!session.codeHash || !verificationCodeMatchesHash(submittedCode, session.codeHash)) {
        await prisma.salePaymentRecoveryVerification.updateMany({
            where: { id: session.id },
            data: { attempts: { increment: 1 } },
        });
        throw new AppError(ErrorCodes.RECOVER_VERIFICATION_CODE_INVALID);
    }

    // Código correcto: se invalida (un solo uso, no reusable) ANTES de hacer
    // cualquier otra cosa.
    await prisma.salePaymentRecoveryVerification.updateMany({
        where: { id: session.id },
        data: { codeHash: null, codeExpiresAt: null, attempts: 0, lastSentAt: null },
    });

    const outcome = await resolvePendingOrConfirmedSaleByPayment({ normalizedEmail, normalizedDocument, normalizedPaymentId });
    logger.info("verifyPaymentRecoveryCodeService completed", { matched: outcome.matched });
    return outcome;
};
