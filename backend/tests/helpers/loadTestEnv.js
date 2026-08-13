// Preload explícito de backend/.env.test — pensado para usarse con
// `node --import ./tests/helpers/loadTestEnv.js --test ...` (ver
// package.json), de forma que DATABASE_URL/DIRECT_URL ya estén poblados
// ANTES de que node:test empiece a importar los archivos de test, que es
// exactamente cuando tests/helpers/dbGuard.js hace su chequeo.
//
// A propósito NUNCA usa `import "dotenv/config"` (que carga `.env` por
// default) — ese fue justamente el vector real: un `backend/.env` de
// producción presente en la terminal, sin ningún `.env.test` propio, hizo
// que `node --test` corriera contra datos reales (ver informe "Encontrar
// el test exacto que contaminó producción"). Este loader SOLO conoce
// `.env.test`, nunca `.env` — y si `.env.test` no existe todavía (checkout
// nuevo, desarrollador que no lo configuró aún), no falla: simplemente no
// carga nada, y dbGuard.js trata la ausencia de DATABASE_URL como "saltear
// tests con DB", nunca como "escribir en cualquier lado".

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const envTestPath = fileURLToPath(new URL("../../.env.test", import.meta.url));

if (existsSync(envTestPath)) {
    config({ path: envTestPath });
}
