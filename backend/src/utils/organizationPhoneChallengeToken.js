import crypto from "node:crypto";

// Token público de un solo uso para el flujo invertido de verificación de
// teléfono/WhatsApp de Organización (ver organizationPhoneVerification.service.js):
// va prearmado en el deep link wa.me como "CONFIRMAR <token>" — el
// organizador nunca lo escribe a mano (lo manda con un toque desde su
// propio WhatsApp), así que no hace falta optimizar para tipeo, pero de
// todos modos se excluyen los caracteres ambiguos (0/O, 1/I/L) por si
// alguna vez hace falta reescribirlo a mano como respaldo.
//
// No es un secreto que haya que esconderle al propio organizador (viaja
// abierto en un mensaje de WhatsApp que él mismo envía) — se hashea igual
// que el resto de los códigos de la app (verificationCode.js) por
// consistencia y porque nunca hace falta recuperar el valor en texto plano
// una vez emitido (cada reintento genera uno nuevo).
const CHARSET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const TOKEN_LENGTH = 10;

export function generateOrganizationPhoneChallengeToken() {
    let token = "";
    for (let i = 0; i < TOKEN_LENGTH; i++) {
        // crypto.randomInt (CSPRNG), no Math.random — mismo criterio de
        // aleatoriedad segura que generateVerificationCode.
        token += CHARSET[crypto.randomInt(0, CHARSET.length)];
    }
    return token;
}

export function hashOrganizationPhoneChallengeToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
}
