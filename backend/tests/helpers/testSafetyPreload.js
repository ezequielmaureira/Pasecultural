// Preload de seguridad para TODA corrida de tests (unit y db — ver
// runTests.mjs). Corre antes de que node:test importe cualquier archivo.
//
// 1. Neutraliza backend/.env (PRODUCCIÓN): `import "@prisma/client"` y
//    `dotenv/config` cargan ese archivo en process.env para toda clave que
//    todavía no exista — así un test podía terminar con la API key real de
//    Resend, Cloudinary, Clerk o Mercado Pago. Acá se lee sólo la LISTA de
//    claves de .env (nunca se usa ningún valor) y cada una que no esté ya
//    definida (por .env.test o por el entorno de la terminal) queda en "".
//    dotenv nunca pisa una variable existente, aunque sea vacía.
// 2. Bloquea fetch a cualquier host que no sea loopback: ningún test puede
//    hablar con Mercado Pago, Resend, Clerk, WhatsApp ni Cloudinary reales.
//    Un test que necesita simular una API reemplaza globalThis.fetch con su
//    propio stub, como siempre.

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";

const productionEnvPath = fileURLToPath(new URL("../../.env", import.meta.url));

if (existsSync(productionEnvPath)) {
    for (const key of Object.keys(parse(readFileSync(productionEnvPath)))) {
        if (!Object.hasOwn(process.env, key)) process.env[key] = "";
    }
}

// Valores propios de test para lo que el código exige al arrancar — nunca
// los de producción: la clave de cifrado de QR es aleatoria por corrida y el
// remitente de emails es un dominio reservado (.invalid), que no existe.
const TEST_DEFAULTS = {
    TICKET_QR_SECRET_KEY: () => randomBytes(32).toString("base64"),
    SCANNER_SESSION_SECRET: () => randomBytes(32).toString("hex"),
    EMAIL_FROM: () => "Smarticket Test <no-reply@smarticket-test.invalid>",
    FRONTEND_URL: () => "http://localhost:5173",
    // Ficticia: los tests que verifican emails simulan la API de Resend con
    // su propio fetch; sin stub, el fetch bloqueado de abajo hace fallar el
    // envío — nunca sale un email real.
    RESEND_API_KEY: () => "re_test_not_a_real_key",
};
for (const [key, makeValue] of Object.entries(TEST_DEFAULTS)) {
    if (!process.env[key]) process.env[key] = makeValue();
}

const LOOPBACK_URL = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/i;
const realFetch = globalThis.fetch;

globalThis.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input?.url ?? String(input);
    if (!LOOPBACK_URL.test(url)) {
        return Promise.reject(new Error(`[testSafetyPreload] fetch bloqueado a un host externo durante los tests: ${new URL(url).host}`));
    }
    return realFetch(input, init);
};
