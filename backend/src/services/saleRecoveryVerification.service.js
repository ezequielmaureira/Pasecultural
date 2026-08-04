import prisma from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { isValidEmail } from "../utils/validateEmail.js";
import { normalizeBuyerDocument, isValidBuyerDocument } from "../utils/validateBuyerDocument.js";
import { maskEmail } from "../utils/maskEmail.js";
import { generateVerificationCode, hashVerificationCode, verificationCodeMatchesHash } from "../utils/verificationCode.js";
import { findConfirmedRecoverableSales } from "./sale.service.js";
import { sendSaleRecoveryVerificationCodeEmail } from "./email/sendSaleRecoveryVerificationCode.service.js";
import { logger } from "../logging/logger.js";

const CODE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutos
const MAX_VERIFICATION_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000; // 1 minuto entre envíos de código

// Segundo factor de "Recuperar mis entradas": email+DNI (recoverSalesService)
// sólo LOCALIZAN una compra, nunca la autorizan a verse — acá vive el
// código de 6 dígitos que sí autoriza. Deliberadamente, TODA respuesta
// pública de este archivo es indistinguible entre "el par existe" y "el par
// no existe" (mismo shape, mismo status, mismo mensaje genérico): cualquier
// diferencia sería un canal lateral para confirmar si un email/DNI
// pertenecen a una compra real. Ver ErrorCatalog.js — a propósito NO hay un
// código de error "no pediste un código todavía": es indistinguible de
// "código incorrecto".

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

// Reclamo atómico de UN envío de código para el par (normalizedEmail,
// normalizedDocument) — mismo criterio que claimVerificationCodeSend en
// scannerInvitation.service.js, adaptado porque acá no hay una fila
// preexistente a la que hacerle CAS: la primera vez que un par pide un
// código hay que crearla. Primero se intenta el UPDATE con el mismo
// WHERE de cooldown que Scanner (sólo avanza si nunca se mandó nada antes,
// o si el cooldown ya pasó); si no matcheó ninguna fila, se intenta crear
// una — si esa creación choca con la unique constraint (P2002) es porque
// alguien más ganó la carrera o el cooldown seguía activo, y se trata igual:
// null (nadie se entera de la diferencia).
async function claimSaleRecoveryVerificationCodeSend(normalizedEmail, normalizedDocument) {
    const now = new Date();
    const cooldownBefore = new Date(now.getTime() - RESEND_COOLDOWN_MS);
    const code = generateVerificationCode();
    const codeFields = {
        codeHash: hashVerificationCode(code),
        codeExpiresAt: new Date(now.getTime() + CODE_EXPIRY_MS),
        attempts: 0,
        lastSentAt: now,
    };

    const updated = await prisma.saleRecoveryVerification.updateMany({
        where: {
            normalizedEmail,
            normalizedDocument,
            OR: [{ lastSentAt: null }, { lastSentAt: { lt: cooldownBefore } }],
        },
        data: codeFields,
    });
    if (updated.count === 1) return code;

    try {
        await prisma.saleRecoveryVerification.create({
            data: { normalizedEmail, normalizedDocument, ...codeFields },
        });
        return code;
    } catch (err) {
        if (err.code === "P2002") return null; // la fila ya existe y el cooldown sigue activo
        throw err;
    }
}

// Si el envío por Resend falla después de haber reclamado el intento, se
// libera el cooldown (vuelve a null) para no dejar a alguien bloqueado 60
// segundos esperando un código que nunca llegó — mismo criterio que
// releaseCooldownAfterFailedSend en scannerInvitation.service.js.
async function releaseCooldownAfterFailedSend(normalizedEmail, normalizedDocument) {
    await prisma.saleRecoveryVerification
        .updateMany({ where: { normalizedEmail, normalizedDocument }, data: { lastSentAt: null } })
        .catch(() => {});
}

// Intenta reclamar+enviar un código para el par, sólo si de verdad hay al
// menos una compra CONFIRMED detrás — nunca crea una fila ni gasta un envío
// real de Resend para un par inventado. Nunca lanza: cualquier falla
// (cooldown activo, Resend caído) queda sólo en el log, nunca en la
// respuesta — ver comentario de arriba sobre canales laterales.
async function claimAndSendIfMatch(normalizedEmail, normalizedDocument, logLabel) {
    const sales = await findConfirmedRecoverableSales(normalizedEmail, normalizedDocument);
    if (sales.length === 0) {
        logger.info(`${logLabel}: sin compras coincidentes`, { matchCount: 0 });
        return;
    }

    const code = await claimSaleRecoveryVerificationCodeSend(normalizedEmail, normalizedDocument);
    if (!code) {
        logger.info(`${logLabel}: cooldown de reenvío activo`, { matchCount: sales.length });
        return;
    }
    try {
        await sendSaleRecoveryVerificationCodeEmail({ to: normalizedEmail, code });
        logger.info(`${logLabel}: código enviado`, { matchCount: sales.length });
    } catch (err) {
        await releaseCooldownAfterFailedSend(normalizedEmail, normalizedDocument);
        logger.error(`${logLabel}: no se pudo enviar el código`, { errorName: err?.name || "Error" });
    }
}

// Paso 1: el comprador busca por email+DNI. Siempre responde lo mismo
// (el email que él mismo tipeó, enmascarado) exista o no una compra real —
// ver claimAndSendIfMatch.
export const requestSaleRecoveryCodeService = async ({ email, buyerDocument }) => {
    const { normalizedEmail, normalizedDocument } = normalizeAndValidateRecoveryIdentity(email, buyerDocument);
    await claimAndSendIfMatch(normalizedEmail, normalizedDocument, "requestSaleRecoveryCodeService");
    return { maskedEmail: maskEmail(normalizedEmail) };
};

// Botón "Reenviar código" de la pantalla de verificación — mismo contrato
// genérico que el paso 1. Vuelve a comprobar la existencia de una compra
// real (no simplemente "ya había una fila") para no convertir el resend en
// una segunda puerta de entrada que mande códigos para pares inventados.
export const resendSaleRecoveryCodeService = async ({ email, buyerDocument }) => {
    const { normalizedEmail, normalizedDocument } = normalizeAndValidateRecoveryIdentity(email, buyerDocument);
    await claimAndSendIfMatch(normalizedEmail, normalizedDocument, "resendSaleRecoveryCodeService");
    return { maskedEmail: maskEmail(normalizedEmail) };
};

// Paso 2: verifica el código de 6 dígitos. Es el ÚNICO lugar de todo el
// flujo que devuelve datos de una compra — recién después de un código
// correcto.
export const verifySaleRecoveryCodeService = async ({ email, buyerDocument, code }) => {
    const { normalizedEmail, normalizedDocument } = normalizeAndValidateRecoveryIdentity(email, buyerDocument);

    const submittedCode = String(code ?? "").trim();
    if (!submittedCode) throw new AppError(ErrorCodes.RECOVER_VERIFICATION_CODE_REQUIRED);

    const session = await prisma.saleRecoveryVerification.findUnique({
        where: { normalizedEmail_normalizedDocument: { normalizedEmail, normalizedDocument } },
    });

    // "Nunca pediste un código para este par" e "ingresaste un código
    // incorrecto" tienen que verse exactamente igual desde afuera.
    if (!session) throw new AppError(ErrorCodes.RECOVER_VERIFICATION_CODE_INVALID);
    if (session.codeExpiresAt && session.codeExpiresAt < new Date()) {
        throw new AppError(ErrorCodes.RECOVER_VERIFICATION_CODE_EXPIRED);
    }
    if (session.attempts >= MAX_VERIFICATION_ATTEMPTS) {
        throw new AppError(ErrorCodes.RECOVER_VERIFICATION_TOO_MANY_ATTEMPTS);
    }

    if (!session.codeHash || !verificationCodeMatchesHash(submittedCode, session.codeHash)) {
        await prisma.saleRecoveryVerification.updateMany({
            where: { id: session.id },
            data: { attempts: { increment: 1 } },
        });
        throw new AppError(ErrorCodes.RECOVER_VERIFICATION_CODE_INVALID);
    }

    // Código correcto: se invalida (no reusable) y recién ahora se devuelven
    // los datos reales de la(s) compra(s).
    await prisma.saleRecoveryVerification.updateMany({
        where: { id: session.id },
        data: { codeHash: null, codeExpiresAt: null, attempts: 0, lastSentAt: null },
    });

    const sales = await findConfirmedRecoverableSales(normalizedEmail, normalizedDocument);
    logger.info("verifySaleRecoveryCodeService completed", { matchCount: sales.length });
    return { sales };
};
