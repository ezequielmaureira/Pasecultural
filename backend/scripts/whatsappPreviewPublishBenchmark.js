// Fase 3O — benchmark REAL (Prisma real, no mocks) de EventServicePort.commit
// en el modo PUBLISH, el camino detrás de PREVIEW_PUBLISH (ver
// utils/whatsappPerf.js, comentario de Fase 3N: "PREVIEW_PUBLISH ≈21s" en
// producción real). A diferencia de whatsappPerfBenchmark.js (deps
// mockeadas, sin Postgres — mide sólo el overhead arquitectónico del
// controller), ESTE script necesita una base Postgres real detrás de
// DATABASE_URL porque lo que se quiere medir es exactamente el número y
// costo de las queries reales que dispara createEventService/
// syncEventLinksService/syncEventScheduleService/updateMyEventService.
//
// SIEMPRE contra una base DESCARTABLE (ver backend/.env.test) — este script
// crea y borra un User/Organization/Event real por corrida. Nunca correr
// contra la base de producción.
//
// Uso:
//   DOTENV_CONFIG_PATH=.env.test node --import dotenv/config scripts/whatsappPreviewPublishBenchmark.js
//
// Reusa el mecanismo real de instrumentación (WHATSAPP_PERF_LOG,
// enterWithActiveTimer) — nunca reimplementa una medición paralela — así el
// desglose de dbCalls que imprime es EXACTAMENTE el mismo shape que
// aparecería en los logs [WA_PERF] de producción.
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import { commit } from "../src/conversation/EventServicePort.js";
import { startWhatsappPerfTimer, enterWithActiveTimer } from "../src/utils/whatsappPerf.js";
import { logger } from "../src/logging/logger.js";

process.env.WHATSAPP_PERF_LOG = "true";

const RUNS = Number(process.env.BENCH_RUNS ?? 5);

if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL. Correr con DOTENV_CONFIG_PATH=.env.test node --import dotenv/config ...");
    process.exit(1);
}

function assertTestDatabase() {
    // Guardrail explícito: este script escribe filas reales (User/
    // Organization/Event) — nunca debe poder correr por accidente contra la
    // base de producción, sin importar cómo se invoque.
    const url = process.env.DATABASE_URL;
    if (/oiyakkbvplxrysjwxwrf/.test(url)) {
        console.error("DATABASE_URL apunta al proyecto de PRODUCCIÓN. Abortando — usar backend/.env.test.");
        process.exit(1);
    }
}
assertTestDatabase();

function uniqueSuffix() {
    return randomUUID().slice(0, 8);
}

async function createUser() {
    const suffix = uniqueSuffix();
    return prisma.user.create({
        data: { clerkId: `clerk_bench_${suffix}`, email: `bench_${suffix}@example.com`, firstName: "Bench", role: "ORGANIZER" },
    });
}

async function createOrganization(ownerId) {
    const suffix = uniqueSuffix();
    return prisma.organization.create({
        data: { name: `Bench Org ${suffix}`, email: `bench_org_${suffix}@example.com`, status: "APPROVED", ownerId },
    });
}

function buildDraft() {
    return {
        title: "Fiesta Benchmark",
        description: "Descripción benchmark",
        category: "MUSICA",
        coverImage: null,
        location: {
            venueName: "Club Benchmark",
            address: "Calle Falsa 123",
            city: "Río Cuarto",
            province: "Córdoba",
            latitude: -33.12,
            longitude: -64.34,
            googlePlaceId: null,
        },
        functions: [
            { date: "2099-08-25", startTime: "20:00", endTime: "23:00" },
            { date: "2099-09-01", startTime: "21:00", endTime: "23:30" },
        ],
        hasTickets: true,
        ticketTypes: [
            { name: "General", price: 20000, quantity: 100 },
            { name: "VIP", price: 45000, quantity: 20 },
        ],
        promoVideoUrl: "https://youtu.be/dQw4w9WgXcQ",
        socialLinks: [{ network: "INSTAGRAM", url: "https://instagram.com/bench" }],
    };
}

async function runOnce() {
    const owner = await createUser();
    const org = await createOrganization(owner.id);

    let captured = null;
    const originalInfo = logger.info;
    logger.info = (msg, payload) => {
        if (msg === "[WA_PERF]") captured = payload;
    };

    const perf = startWhatsappPerfTimer();
    enterWithActiveTimer(perf);
    let event;
    try {
        const startedAt = process.hrtime.bigint();
        event = await commit(owner.clerkId, buildDraft(), "PUBLISH", org.id);
        const wallMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
        perf.finish({ conversationId: "bench", engineAction: "PREVIEW_PUBLISH" });
        return { wallMs, dbCallCount: captured?.dbCallCount ?? 0, dbTotalMs: captured?.dbTotalMs ?? 0, dbCalls: captured?.dbCalls ?? [] };
    } finally {
        logger.info = originalInfo;
        await prisma.event.deleteMany({ where: { id: event ? event.id : "__none__" } });
        await prisma.organization.deleteMany({ where: { id: org.id } });
        await prisma.user.deleteMany({ where: { id: owner.id } });
    }
}

async function main() {
    console.log(`Benchmark REAL (Prisma real contra ${RUNS} corridas) de EventServicePort.commit(PUBLISH) — el camino de PREVIEW_PUBLISH.\n`);
    const results = [];
    for (let i = 0; i < RUNS; i++) {
        const r = await runOnce();
        results.push(r);
        console.log(`  corrida ${i + 1}: wall=${r.wallMs.toFixed(1)}ms  dbCallCount=${r.dbCallCount}  dbTotalMs=${r.dbTotalMs}`);
    }

    const avgWall = results.reduce((a, r) => a + r.wallMs, 0) / results.length;
    const avgDbCalls = results.reduce((a, r) => a + r.dbCallCount, 0) / results.length;
    const avgDbMs = results.reduce((a, r) => a + r.dbTotalMs, 0) / results.length;

    console.log(`\nPromedio: wall=${avgWall.toFixed(1)}ms  dbCallCount=${avgDbCalls.toFixed(1)}  dbTotalMs=${avgDbMs.toFixed(1)}`);
    console.log(`\nDesglose de la última corrida (label -> ms):`);
    for (const call of results[results.length - 1].dbCalls) {
        console.log(`  ${call.label}: ${call.ms}ms`);
    }

    await prisma.$disconnect();
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
