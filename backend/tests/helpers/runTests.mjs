// Separa `npm run test:unit` de `npm run test:db` en dos procesos de
// `node --test` distintos, a partir de UNA sola lista canónica
// (./dbTestFiles.js) — así "test:unit" nunca IMPORTA un archivo que toque
// Prisma real, y por lo tanto nunca dispara el guard de dbGuard.js.
//
// Por qué esto hacía falta: bajo `node --test tests/*.test.js` sin
// preload, el simple `import "@prisma/client"` (que hacen los archivos
// con DB a través de src/config/prisma.js) tiene el efecto secundario de
// poblar process.env.DATABASE_URL con el contenido de backend/.env real
// (producción) — verificado directamente (`node -e "import('@prisma/client')..."`)
// durante esta revisión. dbGuard.js aborta ese archivo correctamente (es
// exactamente para lo que existe), pero un archivo abortado cuenta como
// "fail" para `node --test`, así que una suite llamada "test:unit" nunca
// podía terminar en verde mientras compartiera archivos con "test:db".
//
// dbGuard.js NO se toca ni se debilita acá: test:db sigue dependiendo de
// exactamente la misma validación de siempre (ver loadTestEnv.js más
// abajo), y sigue pudiendo abortar un archivo completo si el entorno
// resultara apuntar a producción — este script sólo decide QUÉ archivos
// se le pasan a `node --test` en cada modo, nunca cómo se valida la DB.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { DB_TEST_FILES } from "./dbTestFiles.js";

const testsDir = fileURLToPath(new URL("..", import.meta.url));
const backendRoot = path.join(testsDir, "..");
const mode = process.argv[2];

if (mode !== "unit" && mode !== "db") {
    console.error('Uso: node tests/helpers/runTests.mjs <unit|db>');
    process.exit(1);
}

const allTestFiles = readdirSync(testsDir)
    .filter((name) => name.endsWith(".test.js"))
    .sort();

// Defensivo: si dbTestFiles.js quedó desactualizado (archivo renombrado o
// borrado), fallar fuerte en vez de correr una lista silenciosamente
// incompleta — la separación unit/db depende por completo de que esta
// lista sea exacta.
const unknownDbFiles = DB_TEST_FILES.filter((name) => !allTestFiles.includes(name));
if (unknownDbFiles.length > 0) {
    console.error(
        `[runTests] tests/helpers/dbTestFiles.js lista archivos que ya no existen en tests/: ${unknownDbFiles.join(", ")}`
    );
    process.exit(1);
}

const dbFileSet = new Set(DB_TEST_FILES);
const selected =
    mode === "db"
        ? allTestFiles.filter((name) => dbFileSet.has(name))
        : allTestFiles.filter((name) => !dbFileSet.has(name));

if (selected.length === 0) {
    console.error(`[runTests] ningún archivo de test para el modo "${mode}".`);
    process.exit(1);
}

const args = ["--test", ...selected.map((name) => `tests/${name}`)];

if (mode === "db") {
    // Mismo preload que antes de esta revisión (carga .env.test ANTES de
    // que node:test importe cualquier archivo, que es exactamente cuando
    // dbGuard.js hace su chequeo) — nunca .env, nunca nada que pueda
    // resolver a producción.
    args.unshift("--import", "./tests/helpers/loadTestEnv.js");
}

const result = spawnSync(process.execPath, args, { stdio: "inherit", cwd: backendRoot });
if (result.error) {
    console.error(result.error);
    process.exit(1);
}
process.exit(result.status ?? 1);
