import prisma from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { isValidEmail } from "../utils/validateEmail.js";
import { generateVerificationCode, hashVerificationCode, verificationCodeMatchesHash } from "../utils/verificationCode.js";
import { sendScannerVerificationCodeEmail } from "./email/sendScannerVerificationCode.service.js";
import { signScannerSessionToken } from "../config/scannerSession.js";
import { logger } from "../logging/logger.js";

// Portal Scanner: acceso recurrente de un scanner YA registrado, por email +
// código de 6 dígitos — reemplaza a la invitación como mecanismo de login
// (ver scannerInvitation.service.js, que ahora sólo sirve para el registro
// inicial). Reutiliza la MISMA infraestructura de código que el registro
// (utils/verificationCode.js, sendScannerVerificationCodeEmail,
// signScannerSessionToken) y los MISMOS campos de EventScanner
// (verificationCodeHash/Expires/Attempts/LastSentAt) — están siempre en
// null mientras el scanner está ACTIVE e inactivo, así que no chocan con el
// uso que les da el registro (que sólo opera sobre filas INVITED).
const CODE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutos
const MAX_VERIFICATION_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000; // 1 minuto entre envíos de código

function normalizeAndValidateEmail(email) {
    const normalizedEmail = email?.trim().toLowerCase();
    if (!normalizedEmail || !isValidEmail(normalizedEmail)) throw new AppError(ErrorCodes.SCANNER_LOGIN_INVALID_EMAIL);
    return normalizedEmail;
}

// A diferencia de la recuperación de compra, acá SÍ se revela si el email
// tiene o no un acceso habilitado — pedido explícito del flujo (mensaje
// genérico en el sentido de "no explica POR QUÉ" — inexistente, revocado,
// deshabilitado — pero SÍ distingue "hay algo" de "no hay nada").
async function findActiveScannerByEmail(normalizedEmail) {
    // Un mismo email podría, en teoría, estar ACTIVE en más de un evento
    // (email no es @@unique en EventScanner) — se toma la activación más
    // reciente. Caso borde documentado, no bloqueante.
    return prisma.eventScanner.findFirst({
        where: { email: normalizedEmail, status: "ACTIVE", deletedAt: null },
        orderBy: { activatedAt: "desc" },
    });
}

// Mismo criterio que claimVerificationCodeSend en scannerInvitation.service.js
// (CAS atómico contra el cooldown), pero sobre status ACTIVE y sin campos
// personales que pisar (ya están cargados desde el registro).
async function claimLoginCodeSend(scannerId) {
    const now = new Date();
    const cooldownBefore = new Date(now.getTime() - RESEND_COOLDOWN_MS);
    const code = generateVerificationCode();

    const claimed = await prisma.eventScanner.updateMany({
        where: {
            id: scannerId,
            status: "ACTIVE",
            OR: [{ verificationLastSentAt: null }, { verificationLastSentAt: { lt: cooldownBefore } }],
        },
        data: {
            verificationCodeHash: hashVerificationCode(code),
            verificationCodeExpiresAt: new Date(now.getTime() + CODE_EXPIRY_MS),
            verificationAttempts: 0,
            verificationLastSentAt: now,
        },
    });

    return claimed.count === 1 ? code : null;
}

async function releaseCooldownAfterFailedSend(scannerId) {
    await prisma.eventScanner.update({ where: { id: scannerId }, data: { verificationLastSentAt: null } }).catch(() => {});
}

async function claimAndSendLoginCode(scanner) {
    const code = await claimLoginCodeSend(scanner.id);
    if (!code) throw new AppError(ErrorCodes.SCANNER_VERIFICATION_RESEND_TOO_SOON);

    const event = await prisma.event.findUnique({ where: { id: scanner.eventId }, select: { title: true } });
    try {
        await sendScannerVerificationCodeEmail({
            eventScannerId: scanner.id,
            to: scanner.email,
            firstName: scanner.firstName,
            eventTitle: event?.title ?? "",
            gate: scanner.gate,
            code,
        });
    } catch (err) {
        await releaseCooldownAfterFailedSend(scanner.id);
        logger.error("scannerLogin: no se pudo enviar el código de verificación", { eventScannerId: scanner.id, errorName: err?.name || "Error" });
        throw new AppError(ErrorCodes.SCANNER_VERIFICATION_EMAIL_FAILED, { cause: err });
    }
}

// Paso 1 del Portal: "Continuar" con el email. Si no hay ningún
// EventScanner ACTIVE con ese email, mensaje genérico ("No encontramos un
// acceso habilitado.") sin más detalle.
export const requestScannerLoginCodeService = async ({ email }) => {
    const normalizedEmail = normalizeAndValidateEmail(email);
    const scanner = await findActiveScannerByEmail(normalizedEmail);
    if (!scanner) throw new AppError(ErrorCodes.SCANNER_LOGIN_NOT_FOUND);

    await claimAndSendLoginCode(scanner);
    logger.info("requestScannerLoginCodeService completed", { eventScannerId: scanner.id, eventId: scanner.eventId });
    return { status: "CODE_SENT" };
};

// Botón "Reenviar código" de la pantalla de verificación del Portal.
export const resendScannerLoginCodeService = async ({ email }) => {
    const normalizedEmail = normalizeAndValidateEmail(email);
    const scanner = await findActiveScannerByEmail(normalizedEmail);
    if (!scanner) throw new AppError(ErrorCodes.SCANNER_LOGIN_NOT_FOUND);

    await claimAndSendLoginCode(scanner);
    logger.info("resendScannerLoginCodeService completed", { eventScannerId: scanner.id, eventId: scanner.eventId });
    return { status: "CODE_SENT" };
};

// Paso 2: código de 6 dígitos correcto -> scannerSessionToken, la MISMA
// credencial que ya emite el registro (config/scannerSession.js), nunca
// ligada a un User/Clerk.
export const verifyScannerLoginCodeService = async ({ email, code }, { userAgent } = {}) => {
    const normalizedEmail = normalizeAndValidateEmail(email);
    const scanner = await findActiveScannerByEmail(normalizedEmail);
    if (!scanner) throw new AppError(ErrorCodes.SCANNER_LOGIN_NOT_FOUND);

    const submittedCode = String(code ?? "").trim();
    if (!submittedCode) throw new AppError(ErrorCodes.SCANNER_VERIFICATION_CODE_REQUIRED);
    // "Nunca pediste un código" y "código incorrecto" quedan indistinguibles
    // a propósito (mismo criterio que recuperación de compra) — acá no hace
    // falta un error propio para ese caso.
    if (!scanner.verificationCodeHash) throw new AppError(ErrorCodes.SCANNER_VERIFICATION_CODE_INVALID);
    if (scanner.verificationCodeExpiresAt && scanner.verificationCodeExpiresAt < new Date()) {
        throw new AppError(ErrorCodes.SCANNER_VERIFICATION_CODE_EXPIRED);
    }
    if (scanner.verificationAttempts >= MAX_VERIFICATION_ATTEMPTS) {
        throw new AppError(ErrorCodes.SCANNER_VERIFICATION_TOO_MANY_ATTEMPTS);
    }

    if (!verificationCodeMatchesHash(submittedCode, scanner.verificationCodeHash)) {
        await prisma.eventScanner.updateMany({
            where: { id: scanner.id, status: "ACTIVE" },
            data: { verificationAttempts: { increment: 1 } },
        });
        throw new AppError(ErrorCodes.SCANNER_VERIFICATION_CODE_INVALID);
    }

    await prisma.eventScanner.updateMany({
        where: { id: scanner.id, status: "ACTIVE" },
        data: {
            verificationCodeHash: null,
            verificationCodeExpiresAt: null,
            verificationAttempts: 0,
            verificationLastSentAt: null,
            lastAccessAt: new Date(),
            lastDevice: userAgent ?? null,
        },
    });

    logger.info("verifyScannerLoginCodeService completed", { eventScannerId: scanner.id, eventId: scanner.eventId });
    return { scannerSessionToken: signScannerSessionToken(scanner.id) };
};
