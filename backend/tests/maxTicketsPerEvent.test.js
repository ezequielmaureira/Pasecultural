import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import { createEventService, syncEventScheduleService } from "../src/services/event.service.js";
import { updatePlanLimitsService } from "../src/services/organizationPlanPolicy.js";

// Suite focalizada — enforcement real de maxTicketsPerEvent (ver el informe
// de la ronda). NO mezclar con eventPlanLimits.test.js (esa suite es
// exclusivamente maxActiveEvents). Mismo patrón de fixtures/guardrail que
// esa suite: tests contra Postgres real (backend/.env.test), nunca mocks de
// Prisma — ver tests/helpers/dbGuard.js.
import { hasDatabase } from "./helpers/dbGuard.js";
const testWithDb = hasDatabase ? test : test.skip;

function uniqueSuffix() {
    return randomUUID().slice(0, 8);
}

async function createUser(overrides = {}) {
    const suffix = uniqueSuffix();
    return prisma.user.create({
        data: {
            clerkId: `clerk_${suffix}`,
            email: `user_${suffix}@example.com`,
            firstName: "Nadia",
            role: "ORGANIZER",
            ...overrides,
        },
    });
}

async function createOrganization(ownerId, overrides = {}) {
    const suffix = uniqueSuffix();
    return prisma.organization.create({
        data: {
            name: `Sala ${suffix}`,
            email: `org_${suffix}@example.com`,
            status: "APPROVED",
            ownerId,
            ...overrides,
        },
    });
}

function locationInput(overrides = {}) {
    return {
        venueName: "Plaza Central",
        formattedAddress: "Calle Falsa 123",
        latitude: -33.12,
        longitude: -64.34,
        ...overrides,
    };
}

async function createDraftTicketedEvent(owner, org, title) {
    return createEventService(owner.clerkId, { title, admissionType: "TICKETED", location: locationInput() }, org.id);
}

async function createDraftFreeEntryEvent(owner, org, title) {
    return createEventService(owner.clerkId, { title, admissionType: "FREE_ENTRY", location: locationInput() }, org.id);
}

// Arma el payload de `functions`/`ticketTypes` para syncEventScheduleService.
// `perFunctionQuantities` es un array (uno por función) de arrays de
// quantityOverride (o null) para cada TicketType, en el mismo orden que
// `ticketTypes`.
function scheduleInput(ticketTypes, perFunctionQuantities) {
    return {
        ticketTypes: ticketTypes.map((tt) => ({ name: tt.name, price: tt.price ?? 100, quantity: tt.quantity })),
        functions: perFunctionQuantities.map((overrides, i) => ({
            date: `2099-08-2${i}T20:00:00-03:00`,
            venue: "Plaza Central",
            ticketAssignments: overrides.map((quantityOverride) => ({
                enabled: true,
                quantityOverride: quantityOverride ?? undefined,
            })),
        })),
    };
}

async function cleanup({ eventIds = [], organizationIds = [], userIds = [] }) {
    await prisma.functionTicketType.deleteMany({ where: { ticketType: { eventId: { in: eventIds } } } });
    await prisma.ticketType.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.eventFunction.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function snapshotPlanLimits() {
    const [free, premium] = await Promise.all([
        prisma.organizationPlanLimits.findUnique({ where: { plan: "FREE" } }),
        prisma.organizationPlanLimits.findUnique({ where: { plan: "PREMIUM" } }),
    ]);
    return { FREE: free, PREMIUM: premium };
}

async function restorePlanLimits(snapshot) {
    for (const plan of ["FREE", "PREMIUM"]) {
        const original = snapshot[plan];
        if (!original) continue;
        const data = {
            maxActiveEvents: original.maxActiveEvents,
            maxCourtesiesPerEvent: original.maxCourtesiesPerEvent,
            maxActiveScanners: original.maxActiveScanners,
            maxTicketsPerEvent: original.maxTicketsPerEvent,
            publicOrgPageEnabled: original.publicOrgPageEnabled,
            whatsappEventCreationEnabled: original.whatsappEventCreationEnabled,
            featuredEligible: original.featuredEligible,
            updatedByUserId: original.updatedByUserId,
        };
        const current = await prisma.organizationPlanLimits.findUnique({ where: { plan } });
        if (current) {
            await prisma.organizationPlanLimits.update({ where: { plan }, data });
        } else {
            await prisma.organizationPlanLimits.create({ data: { plan, ...data } });
        }
    }
}

async function assertRejected(promise) {
    await assert.rejects(promise, (error) => {
        assert.equal(error.message, "PLAN_MAX_TICKETS_PER_EVENT_EXCEEDED");
        assert.equal(typeof error.planTicketsLimit === "number" || error.planTicketsLimit === undefined, true);
        return true;
    });
}

// A) FREE con limit=500, total=500 -> PASS
testWithDb("MT-A: FREE con limit=500 y total exacto 500 permite guardar", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id, { plan: "FREE" });
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let event;
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxTicketsPerEvent: 500 });
        event = await createDraftTicketedEvent(owner, org, "MT-A");
        const input = scheduleInput([{ name: "General", quantity: 500 }], [[null]]);
        const saved = await syncEventScheduleService(owner.clerkId, event.id, input, org.id);
        assert.ok(saved);
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

// B) FREE con limit=500, total=501 -> REJECT
testWithDb("MT-B: FREE con limit=500 y total 501 rechaza el guardado", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id, { plan: "FREE" });
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let event;
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxTicketsPerEvent: 500 });
        event = await createDraftTicketedEvent(owner, org, "MT-B");
        const input = scheduleInput([{ name: "General", quantity: 501 }], [[null]]);
        await assertRejected(syncEventScheduleService(owner.clerkId, event.id, input, org.id));
        const fresh = await prisma.ticketType.findMany({ where: { eventId: event.id } });
        assert.equal(fresh.length, 0, "no debe haber persistido nada");
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

// C) PREMIUM con limit=1000, total=1000 -> PASS
testWithDb("MT-C: PREMIUM con limit=1000 y total exacto 1000 permite guardar", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id, { plan: "PREMIUM" });
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let event;
    try {
        await updatePlanLimitsService("PREMIUM", developer.id, { maxTicketsPerEvent: 1000 });
        event = await createDraftTicketedEvent(owner, org, "MT-C");
        const input = scheduleInput([{ name: "General", quantity: 1000 }], [[null]]);
        const saved = await syncEventScheduleService(owner.clerkId, event.id, input, org.id);
        assert.ok(saved);
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

// D) PREMIUM con limit=1000, total=1001 -> REJECT
testWithDb("MT-D: PREMIUM con limit=1000 y total 1001 rechaza el guardado", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id, { plan: "PREMIUM" });
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let event;
    try {
        await updatePlanLimitsService("PREMIUM", developer.id, { maxTicketsPerEvent: 1000 });
        event = await createDraftTicketedEvent(owner, org, "MT-D");
        const input = scheduleInput([{ name: "General", quantity: 1001 }], [[null]]);
        await assertRejected(syncEventScheduleService(owner.clerkId, event.id, input, org.id));
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

// E) PREMIUM limit=null -> capacidad grande PASS
testWithDb("MT-E: limit null permite cualquier capacidad (ilimitado real)", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id, { plan: "PREMIUM" });
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let event;
    try {
        await updatePlanLimitsService("PREMIUM", developer.id, { maxTicketsPerEvent: null });
        event = await createDraftTicketedEvent(owner, org, "MT-E");
        const input = scheduleInput([{ name: "General", quantity: 999999 }], [[null]]);
        const saved = await syncEventScheduleService(owner.clerkId, event.id, input, org.id);
        assert.ok(saved);
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

// F) limit=0 -> evento con capacidad > 0 REJECT (0 no se trata como null)
testWithDb("MT-F: limit=0 rechaza cualquier capacidad configurada > 0", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id, { plan: "FREE" });
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let event;
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxTicketsPerEvent: 0 });
        event = await createDraftTicketedEvent(owner, org, "MT-F");
        const input = scheduleInput([{ name: "General", quantity: 1 }], [[null]]);
        await assertRejected(syncEventScheduleService(owner.clerkId, event.id, input, org.id));
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

// G) múltiples TicketTypes se suman correctamente
testWithDb("MT-G: suma correctamente múltiples TicketTypes en una función", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id, { plan: "FREE" });
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let event;
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxTicketsPerEvent: 500 });
        event = await createDraftTicketedEvent(owner, org, "MT-G");
        const input = scheduleInput(
            [
                { name: "General", quantity: 300 },
                { name: "VIP", quantity: 100 },
                { name: "Preferencial", quantity: 100 },
            ],
            [[null, null, null]]
        );
        const saved = await syncEventScheduleService(owner.clerkId, event.id, input, org.id);
        assert.ok(saved, "300+100+100=500 debe permitirse");

        const overInput = scheduleInput(
            [
                { name: "General", quantity: 300 },
                { name: "VIP", quantity: 150 },
                { name: "Preferencial", quantity: 100 },
            ],
            [[null, null, null]]
        );
        await assertRejected(syncEventScheduleService(owner.clerkId, event.id, overInput, org.id));
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

// H) múltiples EventFunctions se suman correctamente (total del EVENTO, no por función)
testWithDb("MT-H: suma correctamente la capacidad de múltiples EventFunctions", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id, { plan: "FREE" });
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let event;
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxTicketsPerEvent: 500 });
        event = await createDraftTicketedEvent(owner, org, "MT-H");
        // Viernes: General 200, VIP 50. Sábado: General 200, VIP 50. Total 500.
        const input = scheduleInput(
            [
                { name: "General", quantity: 200 },
                { name: "VIP", quantity: 50 },
            ],
            [
                [null, null],
                [null, null],
            ]
        );
        const saved = await syncEventScheduleService(owner.clerkId, event.id, input, org.id);
        assert.ok(saved, "200+50+200+50=500 debe permitirse");

        // Si sábado VIP fuera 100 (via override) -> total 550 -> rechazado.
        const overInput = scheduleInput(
            [
                { name: "General", quantity: 200 },
                { name: "VIP", quantity: 50 },
            ],
            [
                [null, null],
                [null, 100],
            ]
        );
        await assertRejected(syncEventScheduleService(owner.clerkId, event.id, overInput, org.id));
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

// I) quantityOverride se usa correctamente cuando existe
testWithDb("MT-I: usa quantityOverride en vez de TicketType.quantity cuando existe", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id, { plan: "FREE" });
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let event;
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxTicketsPerEvent: 50 });
        event = await createDraftTicketedEvent(owner, org, "MT-I");
        // TicketType.quantity=1000 pero override=50 -> debe contar 50, no 1000.
        const input = scheduleInput([{ name: "General", quantity: 1000 }], [[50]]);
        const saved = await syncEventScheduleService(owner.clerkId, event.id, input, org.id);
        assert.ok(saved, "el override (50) debe ser lo que cuenta, no el quantity base (1000)");
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

// J) sin quantityOverride se usa TicketType.quantity
testWithDb("MT-J: sin quantityOverride usa TicketType.quantity", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id, { plan: "FREE" });
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let event;
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxTicketsPerEvent: 500 });
        event = await createDraftTicketedEvent(owner, org, "MT-J");
        const input = scheduleInput([{ name: "General", quantity: 501 }], [[null]]);
        await assertRejected(syncEventScheduleService(owner.clerkId, event.id, input, org.id));
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

// K) histórico por encima del límite: current=700, limit=500, requested=650 -> PASS
testWithDb("MT-K: evento histórico sobre el límite puede reducirse sin quedar bloqueado", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id, { plan: "FREE" });
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let event;
    try {
        // Sin límite todavía: se guarda un evento de 700.
        await updatePlanLimitsService("FREE", developer.id, { maxTicketsPerEvent: null });
        event = await createDraftTicketedEvent(owner, org, "MT-K");
        await syncEventScheduleService(owner.clerkId, event.id, scheduleInput([{ name: "General", quantity: 700 }], [[null]]), org.id);

        // Ahora se configura un límite de 500 (por debajo del histórico).
        await updatePlanLimitsService("FREE", developer.id, { maxTicketsPerEvent: 500 });

        // Bajar de 700 a 650 (sigue por encima del límite, pero reduce) -> permitido.
        const saved = await syncEventScheduleService(
            owner.clerkId,
            event.id,
            scheduleInput([{ name: "General", quantity: 650 }], [[null]]),
            org.id
        );
        assert.ok(saved, "reducir de 700 a 650 debe permitirse aunque siga sobre el límite");
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

// L) histórico por encima del límite: current=700, limit=500, requested=750 -> REJECT
testWithDb("MT-L: evento histórico sobre el límite no puede aumentar todavía más", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id, { plan: "FREE" });
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let event;
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxTicketsPerEvent: null });
        event = await createDraftTicketedEvent(owner, org, "MT-L");
        await syncEventScheduleService(owner.clerkId, event.id, scheduleInput([{ name: "General", quantity: 700 }], [[null]]), org.id);

        await updatePlanLimitsService("FREE", developer.id, { maxTicketsPerEvent: 500 });

        await assertRejected(
            syncEventScheduleService(owner.clerkId, event.id, scheduleInput([{ name: "General", quantity: 750 }], [[null]]), org.id)
        );
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

// M) evento bajo límite: current=400, requested=500, limit=500 -> PASS
testWithDb("MT-M: subir hasta exactamente el límite permite guardar", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id, { plan: "FREE" });
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let event;
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxTicketsPerEvent: 500 });
        event = await createDraftTicketedEvent(owner, org, "MT-M");
        await syncEventScheduleService(owner.clerkId, event.id, scheduleInput([{ name: "General", quantity: 400 }], [[null]]), org.id);

        const saved = await syncEventScheduleService(
            owner.clerkId,
            event.id,
            scheduleInput([{ name: "General", quantity: 500 }], [[null]]),
            org.id
        );
        assert.ok(saved);
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

// N) evento bajo límite: current=400, requested=501, limit=500 -> REJECT
testWithDb("MT-N: subir un solo tick por encima del límite rechaza", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id, { plan: "FREE" });
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let event;
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxTicketsPerEvent: 500 });
        event = await createDraftTicketedEvent(owner, org, "MT-N");
        await syncEventScheduleService(owner.clerkId, event.id, scheduleInput([{ name: "General", quantity: 400 }], [[null]]), org.id);

        await assertRejected(
            syncEventScheduleService(owner.clerkId, event.id, scheduleInput([{ name: "General", quantity: 501 }], [[null]]), org.id)
        );
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

// O) cambiar cantidad hacia abajo -> PASS (caso general, sin histórico sobre límite)
testWithDb("MT-O: reducir la capacidad configurada siempre permite guardar", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id, { plan: "FREE" });
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let event;
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxTicketsPerEvent: 500 });
        event = await createDraftTicketedEvent(owner, org, "MT-O");
        await syncEventScheduleService(owner.clerkId, event.id, scheduleInput([{ name: "General", quantity: 300 }], [[null]]), org.id);

        const saved = await syncEventScheduleService(
            owner.clerkId,
            event.id,
            scheduleInput([{ name: "General", quantity: 100 }], [[null]]),
            org.id
        );
        assert.ok(saved);
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

// P) null no se trata como 0 (ya cubierto conceptualmente por MT-E, se
// verifica acá explícitamente comparando contra un límite 0 real).
testWithDb("MT-P: null se comporta como ilimitado, nunca como 0", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id, { plan: "FREE" });
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let event;
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxTicketsPerEvent: null });
        event = await createDraftTicketedEvent(owner, org, "MT-P");
        const input = scheduleInput([{ name: "General", quantity: 1 }], [[null]]);
        const saved = await syncEventScheduleService(owner.clerkId, event.id, input, org.id);
        assert.ok(saved, "con null, incluso 1 entrada configurada debe permitirse (si fuera 0 se rechazaría)");
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

// Q) 0 no se trata como null (ya cubierto por MT-F, se deja explícito acá
// contrastando el mismo escenario con límite null para dejar la asimetría
// clara en una sola suite).
testWithDb("MT-Q: 0 se respeta literal y nunca se confunde con sin límite", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id, { plan: "FREE" });
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let event;
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxTicketsPerEvent: 0 });
        event = await createDraftTicketedEvent(owner, org, "MT-Q");
        const input = scheduleInput([{ name: "General", quantity: 1 }], [[null]]);
        await assertRejected(syncEventScheduleService(owner.clerkId, event.id, input, org.id));
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});

// R) cambiar maxTicketsPerEvent no modifica otras reglas del plan
testWithDb("MT-R: actualizar maxTicketsPerEvent no toca las demás reglas del plan", async () => {
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    try {
        await updatePlanLimitsService("FREE", developer.id, {
            maxActiveEvents: 7,
            maxActiveScanners: 3,
            publicOrgPageEnabled: true,
        });
        const before = await prisma.organizationPlanLimits.findUnique({ where: { plan: "FREE" } });

        await updatePlanLimitsService("FREE", developer.id, { maxTicketsPerEvent: 250 });
        const after = await prisma.organizationPlanLimits.findUnique({ where: { plan: "FREE" } });

        assert.equal(after.maxTicketsPerEvent, 250);
        assert.equal(after.maxActiveEvents, before.maxActiveEvents);
        assert.equal(after.maxActiveScanners, before.maxActiveScanners);
        assert.equal(after.publicOrgPageEnabled, before.publicOrgPageEnabled);
        assert.equal(after.whatsappEventCreationEnabled, before.whatsappEventCreationEnabled);
        assert.equal(after.featuredEligible, before.featuredEligible);
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ userIds: [developer.id] });
    }
});

// Extra — FREE_ENTRY nunca queda bloqueado por este límite: no tiene
// TicketTypes/capacidad configurada, así que su total siempre es 0.
testWithDb("MT-S: un evento FREE_ENTRY nunca se bloquea por maxTicketsPerEvent", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id, { plan: "FREE" });
    const developer = await createUser({ role: "DEVELOPER" });
    const snapshot = await snapshotPlanLimits();
    let event;
    try {
        await updatePlanLimitsService("FREE", developer.id, { maxTicketsPerEvent: 0 });
        event = await createDraftFreeEntryEvent(owner, org, "MT-S");
        const saved = await syncEventScheduleService(
            owner.clerkId,
            event.id,
            { functions: [{ date: "2099-08-25T20:00:00-03:00", venue: "Plaza Central" }], ticketTypes: [] },
            org.id
        );
        assert.ok(saved, "FREE_ENTRY (sin ticketTypes) no debe verse afectado ni siquiera con limit=0");
    } finally {
        await restorePlanLimits(snapshot);
        await cleanup({ eventIds: event ? [event.id] : [], organizationIds: [org.id], userIds: [owner.id, developer.id] });
    }
});
