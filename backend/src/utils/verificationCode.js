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
