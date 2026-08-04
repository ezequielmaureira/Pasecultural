import jwt from "jsonwebtoken";

// Identidad completa del scanner una vez ACTIVE: un JWT propio, sin Clerk y
// sin cuenta detrás — mismo criterio de validación LAZY que qrEncryption.js/
// resend.js (recién exige la variable de entorno al primer uso real, no al
// arrancar el servidor). El token sólo prueba "sos ESTE EventScanner.id";
// nunca es la autorización en sí — cada request protegida vuelve a
// consultar la fila en la base (ver requireScannerSession.js) para que
// desactivar/revocar/eliminar invalide el acceso de inmediato, sin
// necesidad de una lista de tokens revocados.
const TOKEN_TTL_SECONDS = 24 * 60 * 60; // 24hs — alcanza y sobra para un turno de trabajo

let cachedSecret;

function getSecret() {
    if (cachedSecret) return cachedSecret;
    const value = process.env.SCANNER_SESSION_SECRET;
    if (!value || !value.trim()) {
        throw new Error("Falta configurar la variable de entorno SCANNER_SESSION_SECRET.");
    }
    cachedSecret = value.trim();
    return cachedSecret;
}

export function signScannerSessionToken(eventScannerId) {
    return jwt.sign({ sub: eventScannerId, typ: "scanner_session" }, getSecret(), { expiresIn: TOKEN_TTL_SECONDS });
}

// Lanza si la firma no es válida o si venció — nunca devuelve un payload
// "a medias". El llamador (requireScannerSession) decide qué responder.
export function verifyScannerSessionToken(token) {
    const payload = jwt.verify(token, getSecret());
    if (payload?.typ !== "scanner_session" || typeof payload.sub !== "string") {
        throw new Error("invalid_scanner_session_payload");
    }
    return { eventScannerId: payload.sub };
}
