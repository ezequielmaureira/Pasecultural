import prisma from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { isValidEmail } from "../utils/validateEmail.js";
import { normalizeBuyerDocument, isValidBuyerDocument } from "../utils/validateBuyerDocument.js";
import { maskEmail } from "../utils/maskEmail.js";
import { generateVerificationCode, hashVerificationCode, verificationCodeMatchesHash } from "../utils/verificationCode.js";
import { findWithdrawalEligibleSales } from "./sale.service.js";
import { sendWithdrawalRequestOtpEmail } from "./email/sendWithdrawalRequestOtp.service.js";
import { logger } from "../logging/logger.js";

// Botón de arrepentimiento — segundo factor. Estructura y razonamiento de
// seguridad IDÉNTICOS a saleRecoveryVerification.service.js (auditado y
// reutilizado a propósito, ver el informe de entrega): email+DNI sólo
// LOCALIZAN, nunca autorizan; el código de 6 dígitos sí. Tabla propia
// (WithdrawalRequestVerification) por el motivo ya documentado en
// schema.prisma — comparte el par (email, DNI) con la recuperación de
// entradas, así que no puede vivir en la misma tabla sin que un flujo
// invalide el código del otro.
const CODE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutos
const MAX_VERIFICATION_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000; // 1 minuto entre envíos de código

function normalizeAndValidateIdentity(email, buyerDocument) {
    const normalizedEmail = email?.trim().toLowerCase();
    if (!normalizedEmail || !buyerDocument?.trim()) {
        throw new AppError(ErrorCodes.WITHDRAWAL_INFO_REQUIRED);
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

// Reclamo atómico de un envío de código — mismo mecanismo exacto que
// claimSaleRecoveryVerificationCodeSend (updateMany condicionado al
// cooldown; si no matcheó, create; P2002 se trata como "cooldown activo",
// nunca como error).
async function claimWithdrawalRequestOtpSend(normalizedEmail, normalizedDocument) {
    const now = new Date();
    const cooldownBefore = new Date(now.getTime() - RESEND_COOLDOWN_MS);
    const code = generateVerificationCode();
    const codeFields = {
        codeHash: hashVerificationCode(code),
        codeExpiresAt: new Date(now.getTime() + CODE_EXPIRY_MS),
        attempts: 0,
        lastSentAt: now,
    };

    const updated = await prisma.withdrawalRequestVerification.updateMany({
        where: {
            normalizedEmail,
            normalizedDocument,
            OR: [{ lastSentAt: null }, { lastSentAt: { lt: cooldownBefore } }],
        },
        data: codeFields,
    });
    if (updated.count === 1) return code;

    try {
        await prisma.withdrawalRequestVerification.create({
            data: { normalizedEmail, normalizedDocument, ...codeFields },
        });
        return code;
    } catch (err) {
        if (err.code === "P2002") return null;
        throw err;
    }
}

async function releaseCooldownAfterFailedSend(normalizedEmail, normalizedDocument) {
    await prisma.withdrawalRequestVerification
        .updateMany({ where: { normalizedEmail, normalizedDocument }, data: { lastSentAt: null } })
        .catch(() => {});
}

// Nunca crea una fila ni gasta un envío real de Resend para un par sin
// compras elegibles — mismo criterio que claimAndSendIfMatch. Nunca lanza:
// cualquier falla queda sólo en el log, nunca en la respuesta pública.
async function claimAndSendIfMatch(normalizedEmail, normalizedDocument, logLabel) {
    const sales = await findWithdrawalEligibleSales(normalizedEmail, normalizedDocument);
    if (sales.length === 0) {
        logger.info(`${logLabel}: sin compras elegibles`, { matchCount: 0 });
        return;
    }

    const code = await claimWithdrawalRequestOtpSend(normalizedEmail, normalizedDocument);
    if (!code) {
        logger.info(`${logLabel}: cooldown de reenvío activo`, { matchCount: sales.length });
        return;
    }
    try {
        await sendWithdrawalRequestOtpEmail({ to: normalizedEmail, code });
        logger.info(`${logLabel}: código enviado`, { matchCount: sales.length });
    } catch (err) {
        await releaseCooldownAfterFailedSend(normalizedEmail, normalizedDocument);
        logger.error(`${logLabel}: no se pudo enviar el código`, { errorName: err?.name || "Error" });
    }
}

// Paso 1 — respuesta pública SIEMPRE neutral (ver el informe de entrega,
// sección "Privacidad/enumeración"): el mismo shape exista o no una compra
// real, exista o no el par email+DNI.
export const requestWithdrawalRequestOtpService = async ({ email, buyerDocument }) => {
    const { normalizedEmail, normalizedDocument } = normalizeAndValidateIdentity(email, buyerDocument);
    await claimAndSendIfMatch(normalizedEmail, normalizedDocument, "requestWithdrawalRequestOtpService");
    return { maskedEmail: maskEmail(normalizedEmail) };
};

export const resendWithdrawalRequestOtpService = async ({ email, buyerDocument }) => {
    const { normalizedEmail, normalizedDocument } = normalizeAndValidateIdentity(email, buyerDocument);
    await claimAndSendIfMatch(normalizedEmail, normalizedDocument, "resendWithdrawalRequestOtpService");
    return { maskedEmail: maskEmail(normalizedEmail) };
};

// Paso 2 — único lugar que devuelve datos de compras reales, recién
// después de un código correcto. Cada compra devuelta ya trae su
// publicRecoveryToken (bajo el nombre saleToken) — es lo que autoriza el
// paso 3 (crear la solicitud), sin necesidad de una "sesión" aparte: mismo
// modelo de autorización por bearer-token que confirm-by-buyer/status/pdf
// en todo el resto del proyecto.
export const verifyWithdrawalRequestOtpService = async ({ email, buyerDocument, code }) => {
    const { normalizedEmail, normalizedDocument } = normalizeAndValidateIdentity(email, buyerDocument);

    const submittedCode = String(code ?? "").trim();
    if (!submittedCode) throw new AppError(ErrorCodes.WITHDRAWAL_VERIFICATION_CODE_REQUIRED);

    const session = await prisma.withdrawalRequestVerification.findUnique({
        where: { normalizedEmail_normalizedDocument: { normalizedEmail, normalizedDocument } },
    });

    if (!session) throw new AppError(ErrorCodes.WITHDRAWAL_VERIFICATION_CODE_INVALID);
    if (session.codeExpiresAt && session.codeExpiresAt < new Date()) {
        throw new AppError(ErrorCodes.WITHDRAWAL_VERIFICATION_CODE_EXPIRED);
    }
    if (session.attempts >= MAX_VERIFICATION_ATTEMPTS) {
        throw new AppError(ErrorCodes.WITHDRAWAL_VERIFICATION_TOO_MANY_ATTEMPTS);
    }

    if (!session.codeHash || !verificationCodeMatchesHash(submittedCode, session.codeHash)) {
        await prisma.withdrawalRequestVerification.updateMany({
            where: { id: session.id },
            data: { attempts: { increment: 1 } },
        });
        throw new AppError(ErrorCodes.WITHDRAWAL_VERIFICATION_CODE_INVALID);
    }

    // Código correcto: se invalida (no reusable) antes de devolver nada.
    await prisma.withdrawalRequestVerification.updateMany({
        where: { id: session.id },
        data: { codeHash: null, codeExpiresAt: null, attempts: 0, lastSentAt: null },
    });

    const sales = await findWithdrawalEligibleSales(normalizedEmail, normalizedDocument);
    logger.info("verifyWithdrawalRequestOtpService completed", { matchCount: sales.length });
    return { sales, maskedEmail: maskEmail(normalizedEmail) };
};
