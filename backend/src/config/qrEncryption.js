import crypto from "node:crypto";

// Cifrado del secreto del QR (AES-256-GCM). La clave vive únicamente en
// TICKET_QR_SECRET_KEY (fuera de la base) — un dump de la DB solo no
// alcanza para reconstruir el secreto. Reversible (a diferencia de un hash)
// para que GET /tickets/:id/qr pueda devolver siempre el mismo QR en
// visitas futuras, no solo una vez al confirmar la venta.
//
// La validación de la clave es LAZY (recién en el primer encrypt/decrypt
// real), no al importar este módulo. Si validara al importar, CUALQUIER
// arranque del servidor sin esta variable tira abajo TODA la app (login,
// eventos, organizaciones — nada relacionado con tickets) en vez de fallar
// sólo la operación puntual que de verdad la necesita. Mismo chequeo,
// mismo mensaje, misma seguridad — sólo se mueve el momento en que corre.
let cachedKey;

function getKey() {
    if (cachedKey) return cachedKey;

    const key = Buffer.from(process.env.TICKET_QR_SECRET_KEY ?? "", "base64");
    if (key.length !== 32) {
        throw new Error(
            "TICKET_QR_SECRET_KEY debe ser una clave base64 de 32 bytes. Generá una con: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\""
        );
    }

    cachedKey = key;
    return cachedKey;
}

const IV_LENGTH = 12; // recomendado para GCM

export function encryptSecret(plainSecret) {
    const key = getKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(plainSecret, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decryptSecret(encrypted) {
    const key = getKey();
    const raw = Buffer.from(encrypted, "base64");
    const iv = raw.subarray(0, IV_LENGTH);
    const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + 16);
    const ciphertext = raw.subarray(IV_LENGTH + 16);

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
