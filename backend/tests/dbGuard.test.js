import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { classifyDatabaseUrl, PRODUCTION_PROJECT_REF, TEST_PROJECT_REF } from "./helpers/dbGuard.js";

// classifyDatabaseUrl es pura (no lee process.env, no toca Prisma) — se
// prueba directo, sin subprocesos, sin ninguna base real.

test("classifyDatabaseUrl: detecta el project-ref de PRODUCCIÓN en cualquier posición de la URL", () => {
    assert.equal(classifyDatabaseUrl(`postgresql://u:p@db.${PRODUCTION_PROJECT_REF}.supabase.co:5432/postgres`), "PRODUCTION");
    assert.equal(classifyDatabaseUrl(`postgresql://u:p@aws-0-sa.pooler.supabase.com:6543/postgres?options=project%3D${PRODUCTION_PROJECT_REF}`), "PRODUCTION");
});

test("classifyDatabaseUrl: detecta el project-ref de TEST", () => {
    assert.equal(classifyDatabaseUrl(`postgresql://u:p@db.${TEST_PROJECT_REF}.supabase.co:5432/postgres`), "TEST");
});

test("classifyDatabaseUrl: producción gana si por algún motivo ambos project-ref aparecieran en la misma URL", () => {
    assert.equal(classifyDatabaseUrl(`postgresql://u:p@${PRODUCTION_PROJECT_REF}-${TEST_PROJECT_REF}/db`), "PRODUCTION");
});

test("classifyDatabaseUrl: ausente/vacío/null/undefined -> ABSENT", () => {
    assert.equal(classifyDatabaseUrl(undefined), "ABSENT");
    assert.equal(classifyDatabaseUrl(null), "ABSENT");
    assert.equal(classifyDatabaseUrl(""), "ABSENT");
});

test("classifyDatabaseUrl: una URL real pero de ningún proyecto conocido -> OTHER (nunca habilita tests con DB, pero tampoco aborta)", () => {
    assert.equal(classifyDatabaseUrl("postgresql://u:p@localhost:5432/mi_postgres_local"), "OTHER");
});

// ==================================================================
// Comportamiento real al IMPORTAR el módulo — se prueba en un proceso
// Node hijo, con DATABASE_URL/DIRECT_URL controladas por el test, para
// poder verificar el `throw` en el momento exacto del import sin
// necesitar (ni arriesgar) ninguna conexión real. dbGuard.js no importa
// Prisma ni hace ningún I/O más allá de leer process.env, así que esto es
// 100% seguro y determinístico.
// ==================================================================

const DB_GUARD_URL = new URL("./helpers/dbGuard.js", import.meta.url).href;

function probeDbGuard(env) {
    const probeScript = `
        import(${JSON.stringify(DB_GUARD_URL)}).then(
            (mod) => {
                console.log(JSON.stringify({ imported: true, hasDatabase: mod.hasDatabase, status: mod.databaseGuardStatus }));
            },
            (err) => {
                console.log(JSON.stringify({ imported: false, message: err.message }));
            }
        );
    `;
    const output = execFileSync(process.execPath, ["--input-type=module", "-e", probeScript], {
        env: { ...process.env, ...env },
        encoding: "utf8",
    });
    return JSON.parse(output.trim());
}

test("CASO A — DATABASE_URL con project-ref de PRODUCCIÓN: el import aborta, nunca queda hasDatabase=true", () => {
    const result = probeDbGuard({
        DATABASE_URL: `postgresql://u:p@db.${PRODUCTION_PROJECT_REF}.supabase.co:5432/postgres`,
        DIRECT_URL: "",
    });
    assert.equal(result.imported, false, "el import debe fallar (throw), nunca completarse");
    assert.match(result.message, /BLOQUEADO/);
    assert.match(result.message, /PRODUCCIÓN/);
});

test("CASO A (variante) — sólo DIRECT_URL apunta a producción: también aborta", () => {
    const result = probeDbGuard({
        DATABASE_URL: `postgresql://u:p@db.${TEST_PROJECT_REF}.supabase.co:5432/postgres`,
        DIRECT_URL: `postgresql://u:p@db.${PRODUCTION_PROJECT_REF}.supabase.co:5432/postgres`,
    });
    assert.equal(result.imported, false, "DIRECT_URL de producción también debe abortar, aunque DATABASE_URL sea de test");
    assert.match(result.message, /DIRECT_URL/);
});

test("CASO B — DATABASE_URL con project-ref de TEST: el import se completa y habilita los tests con DB", () => {
    const result = probeDbGuard({
        DATABASE_URL: `postgresql://u:p@db.${TEST_PROJECT_REF}.supabase.co:5432/postgres`,
        DIRECT_URL: `postgresql://u:p@db.${TEST_PROJECT_REF}.supabase.co:5432/postgres`,
    });
    assert.equal(result.imported, true);
    assert.equal(result.hasDatabase, true);
    assert.equal(result.status, "TEST");
});

test("CASO C — DATABASE_URL ausente: el import se completa pero los tests con DB quedan deshabilitados", () => {
    const result = probeDbGuard({ DATABASE_URL: "", DIRECT_URL: "" });
    assert.equal(result.imported, true);
    assert.equal(result.hasDatabase, false);
    assert.equal(result.status, "ABSENT");
});

test("CASO C (variante) — DATABASE_URL presente pero de un proyecto desconocido: nunca escribe, igual que ausente", () => {
    const result = probeDbGuard({ DATABASE_URL: "postgresql://u:p@localhost:5432/otra_cosa", DIRECT_URL: "" });
    assert.equal(result.imported, true);
    assert.equal(result.hasDatabase, false);
    assert.equal(result.status, "OTHER");
});
