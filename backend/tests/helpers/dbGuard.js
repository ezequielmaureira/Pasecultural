// Guardrail centralizado — ver informe "Encontrar el test exacto que
// contaminó producción": `whatsappOrganizerDiscovery.test.js` creó datos
// reales en producción porque su único chequeo era
// `Boolean(process.env.DATABASE_URL)`, que sólo verifica que la variable
// EXISTA, nunca a qué proyecto apunta. Cualquier archivo de test que toque
// Prisma real (create/createMany/update/delete/upsert) DEBE importar
// `hasDatabase` desde acá en lugar de calcular su propio guard — un único
// lugar, nunca uno por archivo, para que nunca dependa de que alguien se
// acuerde de escribirlo bien de nuevo.
//
// La protección corre al IMPORTAR este módulo — antes de que el archivo de
// test que lo importa llegue a definir un solo `test(...)`, y mucho antes
// de que exista la posibilidad de crear un fixture. Si DATABASE_URL (o
// DIRECT_URL) apunta al proyecto de producción, este import lanza y aborta
// el archivo completo: ningún test de ese archivo llega a correr.
//
// Nunca se imprime la connection string ni ninguna credencial — sólo se
// compara como substring contra los dos project-ref conocidos.

const PRODUCTION_PROJECT_REF = "oiyakkbvplxrysjwxwrf";
const TEST_PROJECT_REF = "ldxmrsllusbnayerxtbu";

// "PRODUCTION" | "TEST" | "OTHER" | "ABSENT" — pura, sin leer process.env
// directamente, para poder testearla con URLs falsas sin depender de
// variables de entorno reales.
export function classifyDatabaseUrl(rawUrl) {
    if (!rawUrl) return "ABSENT";
    if (rawUrl.includes(PRODUCTION_PROJECT_REF)) return "PRODUCTION";
    if (rawUrl.includes(TEST_PROJECT_REF)) return "TEST";
    return "OTHER";
}

function assertNeverProduction(rawUrl, sourceName) {
    const status = classifyDatabaseUrl(rawUrl);
    if (status === "PRODUCTION") {
        throw new Error(
            `[dbGuard] BLOQUEADO: ${sourceName} apunta al proyecto de PRODUCCIÓN de Supabase. ` +
                "Los tests que usan Prisma real NUNCA deben ejecutarse contra producción — abortando " +
                "antes de crear cualquier fixture. Configurá backend/.env.test con el proyecto de TEST " +
                `(project-ref ${TEST_PROJECT_REF}) y corré los tests con ese archivo cargado ` +
                "(ver npm run test:db / npm test en package.json)."
        );
    }
    return status;
}

const databaseUrlStatus = assertNeverProduction(process.env.DATABASE_URL, "DATABASE_URL");
// Prisma puede usar DIRECT_URL (bypass del connection pooler) para algunas
// operaciones — mismo chequeo, mismo motivo, nunca se confía en que sólo
// DATABASE_URL esté bien configurada.
assertNeverProduction(process.env.DIRECT_URL, "DIRECT_URL");

// Sólo TEST habilita los tests con DB real. ABSENT y OTHER (ej. un Postgres
// local personal que no es ninguno de los dos proyectos conocidos) se
// tratan igual: los tests con DB se saltan — nunca escriben — porque no hay
// forma de confirmar que ese destino es seguro.
export const hasDatabase = databaseUrlStatus === "TEST";

// Expuesto para diagnóstico/tests del guard mismo — nunca es "PRODUCTION"
// en este punto: si lo fuera, el `throw` de arriba ya habría abortado el
// import completo.
export const databaseGuardStatus = databaseUrlStatus;

export { PRODUCTION_PROJECT_REF, TEST_PROJECT_REF };
