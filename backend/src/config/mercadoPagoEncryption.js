import crypto from "node:crypto";

// MP-1 — cifrado de accessToken/refreshToken de Mercado Pago (AES-256-GCM).
// MISMO algoritmo y MISMA estructura que qrEncryption.js (que cifra el
// secreto de TicketQr), pero con su PROPIA clave y su PROPIO módulo,
// intencionalmente: son dos dominios de secretos completamente distintos
// (uno es el secreto de un QR emitido por PaseCultural, el otro son
// credenciales OAuth de un tercero, Mercado Pago) — una rotación o un
// eventual compromiso de una clave nunca debe poder afectar a la otra.
//
// A propósito NO se generalizó/reutilizó qrEncryption.js acá: ese módulo
// es código crítico ya probado en producción (cifra el secreto de CADA
// entrada emitida), y esta fase no necesita tocarlo para funcionar — se
// duplica intencionalmente la MISMA lógica de cifrado ya validada, nunca
// una alternativa nueva sin probar. Ver el informe de entrega de MP-1 para
// el razonamiento completo de esta decisión.
//
// Validación LAZY (recién en el primer encrypt/decrypt real), mismo
// criterio que qrEncryption.js#getKey: si validara al importar, arrancar
// el servidor sin MERCADOPAGO_TOKEN_SECRET_KEY tiraría abajo TODA la app en
// vez de sólo fallar la operación puntual que de verdad la necesita.
let cachedKey;

function getKey() {
    if (cachedKey) return cachedKey;

    const key = Buffer.from(process.env.MERCADOPAGO_TOKEN_SECRET_KEY ?? "", "base64");
    if (key.length !== 32) {
        throw new Error(
            "MERCADOPAGO_TOKEN_SECRET_KEY debe ser una clave base64 de 32 bytes. Generá una con: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\""
        );
    }

    cachedKey = key;
    return cachedKey;
}

const IV_LENGTH = 12; // recomendado para GCM

export function encryptMercadoPagoSecret(plainSecret) {
    const key = getKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(plainSecret, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decryptMercadoPagoSecret(encrypted) {
    const key = getKey();
    const raw = Buffer.from(encrypted, "base64");
    const iv = raw.subarray(0, IV_LENGTH);
    const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + 16);
    const ciphertext = raw.subarray(IV_LENGTH + 16);

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
