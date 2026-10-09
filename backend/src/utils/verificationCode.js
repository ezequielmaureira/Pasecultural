import crypto from "node:crypto";

// Extraído de scannerInvitation.service.js: la misma infraestructura de
// código de 6 dígitos (generar/hashear/comparar) que usa el claim de
// invitaciones de Scanner, reutilizada acá para no reimplementarla en cada
// flujo nuevo que necesite un código por email (ver también
// saleRecoveryVerification.service.js).

export function generateVerificationCode() {
    // crypto.randomInt (CSPRNG), no Math.random — mismo criterio de
    // aleatoriedad segura que el resto de los tokens públicos de la app.
    return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function hashVerificationCode(code) {
    return crypto.createHash("sha256").update(code).digest("hex");
}

// Comparación en tiempo constante — nunca un === directo sobre hashes.
export function verificationCodeMatchesHash(code, storedHash) {
    const submitted = Buffer.from(hashVerificationCode(code), "hex");
    const stored = Buffer.from(storedHash, "hex");
    if (submitted.length !== stored.length) return false;
    return crypto.timingSafeEqual(submitted, stored);
}

// Reserva atómica de UN intento de verificación ANTES de comparar el código.
// El patrón anterior (leer attempts, comparar, recién después incrementar)
// dejaba que una ráfaga de requests en paralelo probara muchos más de `max`
// códigos: todas leían el mismo attempts < max antes de que llegara el
// primer incremento. Con esto, el incremento ES el chequeo — sólo `max`
// requests en total pueden llegar a comparar contra el mismo código.
// `codeHash` (valor y campo) ata la reserva al código vigente: si se generó
// uno nuevo o ya se consumió, no reserva nada.
// `delegate` es el modelo de Prisma (prisma.saleRecoveryVerification, etc.).
export async function reserveVerificationAttempt(delegate, { where, attemptsField = "attempts", hashField = "codeHash", codeHash, max }) {
    const reserved = await delegate.updateMany({
        where: { ...where, [hashField]: codeHash, [attemptsField]: { lt: max } },
        data: { [attemptsField]: { increment: 1 } },
    });
    return reserved.count === 1;
}
