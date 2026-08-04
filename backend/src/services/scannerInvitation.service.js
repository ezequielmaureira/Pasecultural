import crypto from "node:crypto";
import prisma from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { isValidEmail } from "../utils/validateEmail.js";
import { normalizeBuyerDocument, isValidBuyerDocument } from "../utils/validateBuyerDocument.js";
import { sendScannerVerificationCodeEmail } from "./email/sendScannerVerificationCode.service.js";
import { signScannerSessionToken } from "../config/scannerSession.js";
import { logger } from "../logging/logger.js";

const CODE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutos
const MAX_VERIFICATION_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000; // 1 minuto entre envíos de código

function generateVerificationCode() {
    // crypto.randomInt (CSPRNG), no Math.random — mismo criterio de
    // aleatoriedad segura que el resto de los tokens públicos de la app.
    return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

function hashCode(code) {
    return crypto.createHash("sha256").update(code).digest("hex");
}

// Comparación en tiempo constante — nunca un === directo sobre hashes.
function codeMatchesHash(code, storedHash) {
    const submitted = Buffer.from(hashCode(code), "hex");
    const stored = Buffer.from(storedHash, "hex");
    if (submitted.length !== stored.length) return false;
    return crypto.timingSafeEqual(submitted, stored);
}

// Sólo lo necesario para que la pantalla pública de invitación se arme —
// nunca id interno, nunca datos de otros scanners de la misma puerta, y
// nunca ningún dato del código de verificación.
export const getScannerInvitationService = async (token) => {
    if (!token) throw new AppError(ErrorCodes.SCANNER_INVITATION_NOT_FOUND);

    const scanner = await prisma.eventScanner.findUnique({
        where: { invitationToken: token },
        select: {
            status: true,
            gate: true,
            name: true,
            invitationExpiresAt: true,
            deletedAt: true,
            event: { select: { title: true } },
        },
    });
    if (!scanner || scanner.deletedAt) throw new AppError(ErrorCodes.SCANNER_INVITATION_NOT_FOUND);

    const expired = scanner.status === "INVITED" && scanner.invitationExpiresAt && scanner.invitationExpiresAt < new Date();

    return {
        eventTitle: scanner.event.title,
        gate: scanner.gate,
        name: scanner.name,
        status: expired ? "EXPIRED" : scanner.status,
    };
};

// Busca la fila viva por token y aplica las validaciones comunes a
// register/resend/verify — evita repetirlas tres veces. Marca (y persiste)
// una invitación vencida como REVOKED la primera vez que alguien la toca,
// en vez de dejarla "INVITED" para siempre mostrando un estado que ya no
// es real.
async function loadLiveInvitation(token) {
    const scanner = await prisma.eventScanner.findUnique({ where: { invitationToken: token } });
    if (!scanner || scanner.deletedAt) throw new AppError(ErrorCodes.SCANNER_INVITATION_NOT_FOUND);
    if (scanner.status === "REVOKED") throw new AppError(ErrorCodes.SCANNER_INVITATION_REVOKED);

    if (scanner.status === "INVITED" && scanner.invitationExpiresAt && scanner.invitationExpiresAt < new Date()) {
        await prisma.eventScanner.update({ where: { id: scanner.id }, data: { status: "REVOKED" } });
        throw new AppError(ErrorCodes.SCANNER_INVITATION_EXPIRED);
    }

    return scanner;
}

// Reclama atómicamente UN envío de código: sólo avanza si la fila sigue
// INVITED y el cooldown de reenvío ya pasó (o nunca se mandó un código
// antes). Es la misma idea que claimEmailSendAttempt en
// sendSaleConfirmationEmail.service.js — un UPDATE con WHERE es la
// protección real contra doble-envío por doble-click o dos pestañas
// abiertas, no algo que se resuelva sólo en el frontend.
async function claimVerificationCodeSend(scannerId, personalFields) {
    const now = new Date();
    const cooldownBefore = new Date(now.getTime() - RESEND_COOLDOWN_MS);
    const code = generateVerificationCode();

    const claimed = await prisma.eventScanner.updateMany({
        where: {
            id: scannerId,
            status: "INVITED",
            OR: [{ verificationLastSentAt: null }, { verificationLastSentAt: { lt: cooldownBefore } }],
        },
        data: {
            ...personalFields,
            verificationCodeHash: hashCode(code),
            verificationCodeExpiresAt: new Date(now.getTime() + CODE_EXPIRY_MS),
            verificationAttempts: 0,
            verificationLastSentAt: now,
            claimedAt: now,
        },
    });

    return claimed.count === 1 ? code : null;
}

// Si el envío por Resend falla después de haber reclamado el intento, se
// libera el cooldown (vuelve a null) para no dejar a alguien bloqueado 60
// segundos esperando un código que nunca llegó.
async function releaseCooldownAfterFailedSend(scannerId) {
    await prisma.eventScanner.update({ where: { id: scannerId }, data: { verificationLastSentAt: null } }).catch(() => {});
}

async function sendCodeOrThrow(scanner, code) {
    try {
        await sendScannerVerificationCodeEmail({
            eventScannerId: scanner.id,
            to: scanner.email,
            firstName: scanner.firstName,
            eventTitle: scanner.eventTitle,
            gate: scanner.gate,
            code,
        });
    } catch (err) {
        await releaseCooldownAfterFailedSend(scanner.id);
        logger.error("scannerInvitation: no se pudo enviar el código de verificación", { eventScannerId: scanner.id, errorName: err?.name || "Error" });
        throw new AppError(ErrorCodes.SCANNER_VERIFICATION_EMAIL_FAILED, { cause: err });
    }
}

// Paso 3+4 del flujo público: la persona completa el formulario y pide
// "Registrar scanner". No pasa por Clerk en ningún momento — sólo deja los
// datos en la fila y manda el código de 6 dígitos. La fila sigue INVITED
// mientras tanto (no existe un estado "esperando verificación" propio).
export const registerScannerInvitationService = async (token, { firstName, lastName, document, email, phone }) => {
    const scanner = await loadLiveInvitation(token);
    if (scanner.status !== "INVITED") throw new AppError(ErrorCodes.SCANNER_INVITATION_ALREADY_CLAIMED);

    const trimmedFirstName = firstName?.trim();
    const trimmedLastName = lastName?.trim();
    const normalizedEmail = email?.trim().toLowerCase();
    const normalizedDocument = normalizeBuyerDocument(document ?? "");
    const trimmedPhone = phone?.trim() || null;

    if (!trimmedFirstName || !trimmedLastName || !normalizedEmail || !normalizedDocument) {
        throw new AppError(ErrorCodes.SCANNER_REGISTRATION_INFO_REQUIRED);
    }
    if (!isValidEmail(normalizedEmail)) throw new AppError(ErrorCodes.SCANNER_REGISTRATION_INVALID_EMAIL);
    if (!isValidBuyerDocument(normalizedDocument)) throw new AppError(ErrorCodes.SCANNER_REGISTRATION_INVALID_DOCUMENT);

    const personalFields = {
        firstName: trimmedFirstName,
        lastName: trimmedLastName,
        document: normalizedDocument,
        email: normalizedEmail,
        phone: trimmedPhone,
    };

    const code = await claimVerificationCodeSend(scanner.id, personalFields);
    if (!code) throw new AppError(ErrorCodes.SCANNER_VERIFICATION_RESEND_TOO_SOON);

    const event = await prisma.event.findUnique({ where: { id: scanner.eventId }, select: { title: true } });
    await sendCodeOrThrow({ id: scanner.id, email: normalizedEmail, firstName: trimmedFirstName, eventTitle: event?.title ?? "", gate: scanner.gate }, code);

    logger.info("registerScannerInvitationService completed", { eventScannerId: scanner.id, eventId: scanner.eventId });
    return { status: "INVITED", email: normalizedEmail };
};

// "Reenviar código": mismos datos ya guardados, código nuevo. Sólo válido
// si ya se registró al menos una vez antes (si no, no hay a quién
// mandarle nada) — mismo cooldown/CAS que el registro inicial.
export const resendScannerVerificationCodeService = async (token) => {
    const scanner = await loadLiveInvitation(token);
    if (scanner.status !== "INVITED") throw new AppError(ErrorCodes.SCANNER_INVITATION_ALREADY_CLAIMED);
    if (!scanner.email) throw new AppError(ErrorCodes.SCANNER_VERIFICATION_NOT_REQUESTED);

    const code = await claimVerificationCodeSend(scanner.id, {});
    if (!code) throw new AppError(ErrorCodes.SCANNER_VERIFICATION_RESEND_TOO_SOON);

    const event = await prisma.event.findUnique({ where: { id: scanner.eventId }, select: { title: true } });
    await sendCodeOrThrow({ id: scanner.id, email: scanner.email, firstName: scanner.firstName, eventTitle: event?.title ?? "", gate: scanner.gate }, code);

    logger.info("resendScannerVerificationCodeService completed", { eventScannerId: scanner.id, eventId: scanner.eventId });
    return { status: "INVITED", email: scanner.email };
};

// Paso 7+8: valida el código de 6 dígitos. Si es correcto, pasa DIRECTO a
// ACTIVE (sin aprobación manual, sin Clerk, sin User) y devuelve un
// scannerSessionToken propio — esa es la ÚNICA credencial que va a existir
// de acá en más para esta persona; no queda ligada a ninguna cuenta.
export const verifyScannerInvitationCodeService = async (token, code, { userAgent } = {}) => {
    const scanner = await loadLiveInvitation(token);

    if (scanner.status === "ACTIVE") {
        // Reabrir la misma pantalla después de haber verificado ya (doble
        // pestaña, refresh, doble click) no es un error — se responde con
        // el estado actual Y un token nuevo (varios tokens válidos para el
        // mismo EventScanner pueden convivir sin problema: son stateless,
        // lo único que importa es que la fila siga ACTIVE en cada request).
        const event = await prisma.event.findUnique({ where: { id: scanner.eventId }, select: { title: true } });
        return {
            status: "ACTIVE",
            eventTitle: event?.title ?? "",
            gate: scanner.gate,
            name: scanner.name,
            scannerSessionToken: signScannerSessionToken(scanner.id),
        };
    }
    if (scanner.status !== "INVITED") throw new AppError(ErrorCodes.SCANNER_INVITATION_ALREADY_CLAIMED);

    if (!scanner.verificationCodeHash) throw new AppError(ErrorCodes.SCANNER_VERIFICATION_NOT_REQUESTED);
    if (scanner.verificationCodeExpiresAt && scanner.verificationCodeExpiresAt < new Date()) {
        throw new AppError(ErrorCodes.SCANNER_VERIFICATION_CODE_EXPIRED);
    }
    if (scanner.verificationAttempts >= MAX_VERIFICATION_ATTEMPTS) {
        throw new AppError(ErrorCodes.SCANNER_VERIFICATION_TOO_MANY_ATTEMPTS);
    }

    const submittedCode = String(code ?? "").trim();
    if (!submittedCode) throw new AppError(ErrorCodes.SCANNER_VERIFICATION_CODE_REQUIRED);

    if (!codeMatchesHash(submittedCode, scanner.verificationCodeHash)) {
        await prisma.eventScanner.updateMany({
            where: { id: scanner.id, status: "INVITED" },
            data: { verificationAttempts: { increment: 1 } },
        });
        throw new AppError(ErrorCodes.SCANNER_VERIFICATION_CODE_INVALID);
    }

    const now = new Date();

    // Respeta @@unique([eventId, email]): si este email ya tiene otra fila
    // no revocada para el MISMO evento (otra puerta, por ejemplo), no puede
    // activar una segunda.
    const existingForEvent = await prisma.eventScanner.findFirst({
        where: { eventId: scanner.eventId, email: scanner.email, deletedAt: null, status: { not: "REVOKED" }, id: { not: scanner.id } },
    });
    if (existingForEvent) throw new AppError(ErrorCodes.SCANNER_INVITATION_ALREADY_ASSIGNED);

    const claimed = await prisma.eventScanner.updateMany({
        where: { id: scanner.id, status: "INVITED" },
        data: {
            status: "ACTIVE",
            activatedAt: now,
            lastAccessAt: now,
            lastDevice: userAgent ?? null,
            verificationCodeHash: null,
            verificationCodeExpiresAt: null,
            verificationAttempts: 0,
            verificationLastSentAt: null,
        },
    });
    if (claimed.count !== 1) throw new AppError(ErrorCodes.SCANNER_INVITATION_ALREADY_CLAIMED);

    const event = await prisma.event.findUnique({ where: { id: scanner.eventId }, select: { title: true } });
    logger.info("verifyScannerInvitationCodeService completed", { eventScannerId: scanner.id, eventId: scanner.eventId });
    return {
        status: "ACTIVE",
        eventTitle: event?.title ?? "",
        gate: scanner.gate,
        name: scanner.name,
        scannerSessionToken: signScannerSessionToken(scanner.id),
    };
};
