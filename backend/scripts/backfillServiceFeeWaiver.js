// Backfill ÚNICO del beneficio para compradores (cargo de servicio $0) en
// las organizaciones que ya existían antes de la migración
// 20261008120000_organization_service_fee_waiver.
//
// Regla (la misma que usa la publicación real, ver
// serviceFeeWaiver.service.js#findFirstPublicationEvidence):
//   firstEventPublishedAt = MIN(Event.publishedAt); si no hay, createdAt
//   del evento PUBLISHED más antiguo con publishedAt null; si no hay
//   evidencia, null (SIN INICIAR).
//   serviceFeeWaivedUntil = firstEventPublishedAt + N meses calendario, con
//   N = service_fee_settings.serviceFeeWaiverDurationMonths al momento de
//   correr el script (0 → null: sin promoción inicial).
// Nunca regala un período nuevo: una organización que publicó hace más de
// N meses queda VENCIDA; una que publicó hace menos conserva sólo lo que
// le queda.
//
// Uso:
//   node scripts/backfillServiceFeeWaiver.js
//       -> DRY RUN (por defecto). Todas las lecturas corren dentro de una
//          transacción READ ONLY: Postgres rechaza cualquier escritura.
//          Lee la duración real de service_fee_settings. Si la tabla todavía
//          no existe (migración sin aplicar), aborta salvo que se pase
//          --assume-duration-months=N, y lo dice explícito en la salida.
//   node scripts/backfillServiceFeeWaiver.js --apply
//       -> escribe, sólo en organizaciones con firstEventPublishedAt null
//          (updateMany condicionado: nunca pisa un valor ya registrado por
//          una publicación real). Requiere la migración aplicada y usa
//          SIEMPRE la duración guardada (ignora --assume-duration-months).
import "dotenv/config";
import prisma from "../src/config/prisma.js";
import {
    findFirstPublicationEvidence,
    getServiceFeeWaiverDurationMonths,
    getServiceFeeWaiverStatus,
    initialServiceFeeWaivedUntil,
    isValidServiceFeeWaiverDurationMonths,
} from "../src/services/serviceFeeWaiver.service.js";

const SOURCE_LABEL = { publishedAt: "publishedAt", createdAt: "fallback createdAt", none: "sin publicación" };
const STATUS_LABEL = { ACTIVE: "ACTIVO", EXPIRED: "VENCIDO", NOT_STARTED: "SIN INICIAR", NONE: "SIN BENEFICIO" };

function describeDatabase() {
    try {
        const url = new URL(process.env.DATABASE_URL);
        return `${url.hostname}${url.pathname}`;
    } catch {
        return "(DATABASE_URL no parseable)";
    }
}

const formatDate = (date) =>
    date
        ? new Date(date).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", dateStyle: "short", timeStyle: "short" })
        : "—";

// Duración real configurada. Dentro de la transacción READ ONLY un error
// de SQL aborta la transacción entera, así que primero se pregunta si la
// tabla existe (to_regclass nunca falla).
async function resolveDurationMonths(client, assumed) {
    const [{ exists }] = await client.$queryRaw`SELECT to_regclass('public.service_fee_settings') IS NOT NULL AS "exists"`;
    if (exists) return { durationMonths: await getServiceFeeWaiverDurationMonths(client), source: "service_fee_settings" };
    if (assumed === null) {
        throw new Error(
            "service_fee_settings no existe todavía (migración sin aplicar). Para un dry run pasá --assume-duration-months=N con el valor que va a tener."
        );
    }
    return { durationMonths: assumed, source: `ASUMIDO --assume-duration-months=${assumed} (la tabla aún no existe)` };
}

async function buildPlan(client, now, durationMonths) {
    // Sólo columnas que ya existen antes de la migración: el dry run corre
    // igual contra una base sin las columnas nuevas.
    const organizations = await client.organization.findMany({
        select: { id: true, name: true, createdAt: true },
        orderBy: { createdAt: "asc" },
    });

    const plan = [];
    for (const organization of organizations) {
        const evidence = await findFirstPublicationEvidence(client, organization.id);
        // Diagnóstico: eventos PUBLISHED sin publishedAt aunque la regla ya
        // haya usado MIN(publishedAt) — si alguno es más viejo, la primera
        // publicación real pudo haber sido antes.
        const legacyPublished = await client.event.findFirst({
            where: { organizationId: organization.id, status: "PUBLISHED", publishedAt: null },
            orderBy: { createdAt: "asc" },
            select: { createdAt: true },
        });
        const firstEventPublishedAt = evidence?.date ?? null;
        const serviceFeeWaivedUntil = firstEventPublishedAt ? initialServiceFeeWaivedUntil(firstEventPublishedAt, durationMonths) : null;
        plan.push({
            id: organization.id,
            name: organization.name,
            source: evidence?.source ?? "none",
            firstEventPublishedAt,
            serviceFeeWaivedUntil,
            status: getServiceFeeWaiverStatus({ firstEventPublishedAt, serviceFeeWaivedUntil }, now),
            legacyOlderThanFirst:
                Boolean(legacyPublished) && Boolean(firstEventPublishedAt) && legacyPublished.createdAt < firstEventPublishedAt,
        });
    }
    return plan;
}

function printPlan(plan, now) {
    console.log(`Ahora: ${formatDate(now)} (hora Argentina)`);
    for (const row of plan) {
        console.log(
            [
                row.name,
                row.id,
                `first=${formatDate(row.firstEventPublishedAt)}`,
                `fuente=${SOURCE_LABEL[row.source]}`,
                `hasta=${formatDate(row.serviceFeeWaivedUntil)}`,
                STATUS_LABEL[row.status],
                row.legacyOlderThanFirst ? "⚠ hay un PUBLISHED sin publishedAt más viejo" : "",
            ]
                .filter(Boolean)
                .join(" | ")
        );
    }
    const count = (status) => plan.filter((row) => row.status === status).length;
    console.log("");
    console.log(
        `Total ${plan.length} — ACTIVAS ${count("ACTIVE")} · VENCIDAS ${count("EXPIRED")} · SIN INICIAR ${count("NOT_STARTED")} · SIN BENEFICIO (duración 0) ${count("NONE")}`
    );
    console.log(
        `Fuentes — publishedAt ${plan.filter((r) => r.source === "publishedAt").length} · fallback createdAt ${
            plan.filter((r) => r.source === "createdAt").length
        } · sin publicación ${plan.filter((r) => r.source === "none").length}`
    );
}

async function main() {
    const apply = process.argv.includes("--apply");
    const assumedArg = process.argv.find((a) => a.startsWith("--assume-duration-months="));
    const assumed = assumedArg ? Number(assumedArg.slice("--assume-duration-months=".length)) : null;
    if (assumed !== null && !isValidServiceFeeWaiverDurationMonths(assumed)) {
        throw new Error("--assume-duration-months debe ser un entero entre 0 y 12");
    }
    const now = new Date();
    console.log(`Base: ${describeDatabase()} — modo ${apply ? "APPLY" : "DRY RUN (solo lectura)"}`);

    if (!apply) {
        const { plan, duration } = await prisma.$transaction(
            async (tx) => {
                await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
                const duration = await resolveDurationMonths(tx, assumed);
                return { duration, plan: await buildPlan(tx, now, duration.durationMonths) };
            },
            { timeout: 120_000, maxWait: 20_000 }
        );
        console.log(`Duración del beneficio: ${duration.durationMonths} mes(es) — fuente: ${duration.source}`);
        console.log("");
        printPlan(plan, now);
        return;
    }

    const durationMonths = await getServiceFeeWaiverDurationMonths();
    console.log(`Duración del beneficio: ${durationMonths} mes(es) — fuente: service_fee_settings`);
    console.log("");
    const plan = await buildPlan(prisma, now, durationMonths);
    printPlan(plan, now);
    let written = 0;
    for (const row of plan) {
        if (!row.firstEventPublishedAt) continue;
        const { count } = await prisma.organization.updateMany({
            where: { id: row.id, firstEventPublishedAt: null },
            data: { firstEventPublishedAt: row.firstEventPublishedAt, serviceFeeWaivedUntil: row.serviceFeeWaivedUntil },
        });
        written += count;
    }
    console.log("");
    console.log(`Escritas: ${written} organizaciones (las que ya tenían firstEventPublishedAt no se tocaron).`);
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
