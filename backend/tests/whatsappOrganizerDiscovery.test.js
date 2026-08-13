import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import {
    resolveOrganizationSelectionChoice,
    mergeOrganizationCandidates,
    discoverWhatsappOrganizationCandidates,
} from "../src/services/whatsappOrganizerDiscovery.service.js";

// Fase 2G — resolveOrganizationSelectionChoice/mergeOrganizationCandidates
// son las únicas funciones puras de whatsappOrganizerDiscovery.service.js
// (el resto toca Prisma; se ejercita indirectamente vía
// tests/whatsapp.organizerBot.test.js, mismo criterio que
// whatsappOrganizerLink.test.js con las funciones puras de Fase 2F).

const CANDIDATES = ["org_1", "org_2", "org_3"];

test("resolveOrganizationSelectionChoice: a valid 1-based index resolves the matching organizationId", () => {
    assert.deepEqual(resolveOrganizationSelectionChoice(CANDIDATES, "1"), { valid: true, organizationId: "org_1" });
    assert.deepEqual(resolveOrganizationSelectionChoice(CANDIDATES, "2"), { valid: true, organizationId: "org_2" });
    assert.deepEqual(resolveOrganizationSelectionChoice(CANDIDATES, "3"), { valid: true, organizationId: "org_3" });
});

test("resolveOrganizationSelectionChoice: tolerates surrounding whitespace", () => {
    assert.deepEqual(resolveOrganizationSelectionChoice(CANDIDATES, "  2  "), { valid: true, organizationId: "org_2" });
});

test("resolveOrganizationSelectionChoice: rejects an index of zero or negative", () => {
    assert.deepEqual(resolveOrganizationSelectionChoice(CANDIDATES, "0"), { valid: false });
    assert.deepEqual(resolveOrganizationSelectionChoice(CANDIDATES, "-1"), { valid: false });
});

test("resolveOrganizationSelectionChoice: rejects an index past the end of the real candidate list", () => {
    assert.deepEqual(resolveOrganizationSelectionChoice(CANDIDATES, "4"), { valid: false });
    assert.deepEqual(resolveOrganizationSelectionChoice(CANDIDATES, "999"), { valid: false });
});

test("resolveOrganizationSelectionChoice: never accepts a manually-typed organizationId, name, clerkId or free text", () => {
    for (const rawText of ["org_2", "Elvis Bar", "user_123", "clerkId=org_2", "2do", "2.0", "2 "]) {
        const result = resolveOrganizationSelectionChoice(CANDIDATES, rawText);
        if (rawText === "2 ") continue; // whitespace-trimmed numeric — valid on purpose, covered above
        assert.equal(result.valid, false, `esperaba valid:false para "${rawText}"`);
    }
});

test("resolveOrganizationSelectionChoice: rejects non-string/empty input without throwing", () => {
    assert.deepEqual(resolveOrganizationSelectionChoice(CANDIDATES, ""), { valid: false });
    assert.deepEqual(resolveOrganizationSelectionChoice(CANDIDATES, null), { valid: false });
    assert.deepEqual(resolveOrganizationSelectionChoice(CANDIDATES, undefined), { valid: false });
});

test("resolveOrganizationSelectionChoice: with a single candidate, only '1' is valid", () => {
    assert.deepEqual(resolveOrganizationSelectionChoice(["org_1"], "1"), { valid: true, organizationId: "org_1" });
    assert.deepEqual(resolveOrganizationSelectionChoice(["org_1"], "2"), { valid: false });
});

// ==================================================================
// FIX — mergeOrganizationCandidates: unión + dedupe EXCLUSIVAMENTE por
// organizationId (sección "PASO 2" del pedido: nunca por nombre, teléfono,
// responsable o DNI). Extraída como función pura específicamente para
// poder probar esta lógica sin tocar Prisma — es el corazón real del fix.
// ==================================================================

const cineNadia = { organizationId: "org_cine_nadia", name: "Cine Nadia", clerkId: "user_A", ownerFirstName: "Ezequiel" };
const laTaberna = { organizationId: "org_la_taberna", name: "La Taberna de Mou", clerkId: "user_A", ownerFirstName: "Ezequiel" };

test("mergeOrganizationCandidates: union of two disjoint sets returns both, byLink first", () => {
    assert.deepEqual(mergeOrganizationCandidates([cineNadia], [laTaberna]), [cineNadia, laTaberna]);
});

test("mergeOrganizationCandidates: an empty byLink still returns everything from byPhone (the exact regression: nothing linked yet)", () => {
    assert.deepEqual(mergeOrganizationCandidates([], [cineNadia, laTaberna]), [cineNadia, laTaberna]);
});

test("mergeOrganizationCandidates: an empty byPhone still returns everything from byLink", () => {
    assert.deepEqual(mergeOrganizationCandidates([cineNadia, laTaberna], []), [cineNadia, laTaberna]);
});

test("mergeOrganizationCandidates: dedupes exclusively by organizationId — a duplicate id is collapsed even if name/clerkId differ", () => {
    const staleCopy = { organizationId: "org_cine_nadia", name: "Cine Nadia (nombre viejo)", clerkId: "user_OTRO", ownerFirstName: "Otro" };
    const result = mergeOrganizationCandidates([cineNadia], [staleCopy, laTaberna]);
    assert.deepEqual(result, [cineNadia, laTaberna], "la primera aparición (byLink) gana, nunca se duplica por id");
});

test("mergeOrganizationCandidates: two organizations sharing name/phone/owner are NEVER collapsed — only organizationId identifies them", () => {
    const sameOwnerDifferentOrg = { organizationId: "org_la_taberna", name: "Cine Nadia", clerkId: "user_A", ownerFirstName: "Ezequiel" };
    // Aunque "name"/"clerkId" coincidan con cineNadia, el organizationId es
    // distinto ("org_la_taberna") — deben quedar como DOS candidatos.
    const result = mergeOrganizationCandidates([cineNadia], [sameOwnerDifferentOrg]);
    assert.equal(result.length, 2);
});

test("mergeOrganizationCandidates: both empty returns empty", () => {
    assert.deepEqual(mergeOrganizationCandidates([], []), []);
});

// ==================================================================
// discoverWhatsappOrganizationCandidates — integración real contra
// Postgres (create/relaciones/constraints @unique no son expresables como
// funciones puras, mismo criterio que el resto del proyecto — ningún
// service que toca Prisma tiene test unitario con mocks, ver informe de
// Fase 2G). Se saltan limpiamente sin DATABASE_URL (caso normal de
// `node --test` en este sandbox) — se corrieron una vez, de verdad, contra
// un PostgreSQL descartable para probar cada escenario end-to-end,
// incluido el caso crítico de regresión (escenario 5).
// ==================================================================

// Guardrail centralizado — ver tests/helpers/dbGuard.js. NUNCA reemplazar
// por `Boolean(process.env.DATABASE_URL)` acá: ese chequeo fue exactamente
// lo que permitió que este archivo escribiera datos reales en producción
// (ver informe "Encontrar el test exacto que contaminó producción").
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
            email: `owner_${suffix}@example.com`,
            firstName: "Ezequiel",
            role: "ORGANIZER",
            ...overrides,
        },
    });
}

async function createOrganization(ownerId, overrides = {}) {
    const suffix = uniqueSuffix();
    return prisma.organization.create({
        data: {
            name: `Test Org ${suffix}`,
            email: `org_${suffix}@example.com`,
            status: "APPROVED",
            phone: "2984405532",
            ownerId,
            ...overrides,
        },
    });
}

async function cleanup({ organizationIds = [], userIds = [] }) {
    await prisma.whatsappOrganizerLink.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

const WA_ID = "5492984405532"; // +54 9 2984 405532 -> normaliza a "2984405532"

// 1) teléfono sin organizaciones
testWithDb("1) a phone with no matching organizations at all returns an empty list", async () => {
    const result = await discoverWhatsappOrganizationCandidates("5491100000000");
    assert.deepEqual(result, []);
});

// 2) una Organization APPROVED, sin link
testWithDb("2) a phone with one APPROVED organization and no existing link discovers it and creates the link", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id, { name: "Cine Nadia" });
    try {
        const result = await discoverWhatsappOrganizationCandidates(WA_ID);
        assert.equal(result.length, 1);
        assert.equal(result[0].organizationId, org.id);
        assert.equal(result[0].name, "Cine Nadia");

        const link = await prisma.whatsappOrganizerLink.findUnique({ where: { organizationId: org.id } });
        assert.ok(link, "el link faltante debe crearse automáticamente");
        assert.equal(link.waId, WA_ID);
    } finally {
        await cleanup({ organizationIds: [org.id], userIds: [owner.id] });
    }
});

// 3) una Organization APPROVED con link ya existente
testWithDb("3) a phone with one APPROVED organization already linked resolves it via the link, without re-querying by phone", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id, { name: "Cine Nadia" });
    await prisma.whatsappOrganizerLink.create({ data: { waId: WA_ID, organizationId: org.id } });
    try {
        const result = await discoverWhatsappOrganizationCandidates(WA_ID);
        assert.equal(result.length, 1);
        assert.equal(result[0].organizationId, org.id);
    } finally {
        await cleanup({ organizationIds: [org.id], userIds: [owner.id] });
    }
});

// 4) dos Organizations APPROVED, ninguna vinculada
testWithDb("4) a phone with two APPROVED organizations and no links discovers BOTH and creates both links", async () => {
    const owner = await createUser();
    const cine = await createOrganization(owner.id, { name: "Cine Nadia" });
    const taberna = await createOrganization(owner.id, { name: "La Taberna de Mou" });
    try {
        const result = await discoverWhatsappOrganizationCandidates(WA_ID);
        const names = result.map((c) => c.name).sort();
        assert.deepEqual(names, ["Cine Nadia", "La Taberna de Mou"]);

        const links = await prisma.whatsappOrganizerLink.findMany({ where: { waId: WA_ID } });
        assert.equal(links.length, 2);
    } finally {
        await cleanup({ organizationIds: [cine.id, taberna.id], userIds: [owner.id] });
    }
});

// 5) EL CASO CRÍTICO DE REGRESIÓN — dos Organizations APPROVED, sólo una
// previamente vinculada. Antes del fix, esto devolvía SÓLO la vinculada
// (return temprano apenas encontraba cualquier link) y jamás descubría la
// segunda por teléfono. Debe devolver las DOS.
testWithDb("5) REGRESSION — two APPROVED organizations sharing a phone, only one previously linked, must return BOTH", async () => {
    const owner = await createUser();
    const cine = await createOrganization(owner.id, { name: "Cine Nadia" });
    const taberna = await createOrganization(owner.id, { name: "La Taberna de Mou" });
    // Sólo Cine Nadia ya estaba vinculada (ej. de un contacto anterior, o de
    // cuando La Taberna de Mou todavía no estaba APPROVED).
    await prisma.whatsappOrganizerLink.create({ data: { waId: WA_ID, organizationId: cine.id } });
    try {
        const result = await discoverWhatsappOrganizationCandidates(WA_ID);
        const names = result.map((c) => c.name).sort();
        assert.deepEqual(names, ["Cine Nadia", "La Taberna de Mou"], "las DOS deben aparecer, no sólo la ya vinculada");

        // El link faltante para La Taberna de Mou se crea en esta misma llamada.
        const tabernaLink = await prisma.whatsappOrganizerLink.findUnique({ where: { organizationId: taberna.id } });
        assert.ok(tabernaLink, "el link faltante de la segunda organización debe crearse automáticamente");
        assert.equal(tabernaLink.waId, WA_ID);

        // El link de Cine Nadia sigue siendo exactamente el mismo (nunca se
        // recrea ni se pisa).
        const links = await prisma.whatsappOrganizerLink.findMany({ where: { waId: WA_ID } });
        assert.equal(links.length, 2);
    } finally {
        await cleanup({ organizationIds: [cine.id, taberna.id], userIds: [owner.id] });
    }
});

// 6) dos Organizations APPROVED, ambas ya vinculadas
testWithDb("6) a phone with two APPROVED organizations, both already linked, resolves both via links only", async () => {
    const owner = await createUser();
    const cine = await createOrganization(owner.id, { name: "Cine Nadia" });
    const taberna = await createOrganization(owner.id, { name: "La Taberna de Mou" });
    await prisma.whatsappOrganizerLink.create({ data: { waId: WA_ID, organizationId: cine.id } });
    await prisma.whatsappOrganizerLink.create({ data: { waId: WA_ID, organizationId: taberna.id } });
    try {
        const result = await discoverWhatsappOrganizationCandidates(WA_ID);
        assert.equal(result.length, 2);
        const links = await prisma.whatsappOrganizerLink.findMany({ where: { waId: WA_ID } });
        assert.equal(links.length, 2, "no se crean links de más");
    } finally {
        await cleanup({ organizationIds: [cine.id, taberna.id], userIds: [owner.id] });
    }
});

// 8/9) el link faltante se crea; llamar dos veces nunca lo duplica
// (organizationId es @unique en WhatsappOrganizerLink).
testWithDb("8/9) calling discovery twice for the same unlinked organization creates the link once, never a duplicate", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id, { name: "Cine Nadia" });
    try {
        await discoverWhatsappOrganizationCandidates(WA_ID);
        const result2 = await discoverWhatsappOrganizationCandidates(WA_ID);
        assert.equal(result2.length, 1);

        const links = await prisma.whatsappOrganizerLink.findMany({ where: { organizationId: org.id } });
        assert.equal(links.length, 1, "nunca se duplica el link ya creado");
    } finally {
        await cleanup({ organizationIds: [org.id], userIds: [owner.id] });
    }
});

// 10) Organization no APPROVED nunca aparece, aunque el teléfono coincida.
testWithDb("10) a non-APPROVED organization with a matching phone is excluded, even with two otherwise-matching orgs", async () => {
    const owner = await createUser();
    const cine = await createOrganization(owner.id, { name: "Cine Nadia" });
    const pending = await createOrganization(owner.id, { name: "Organización Pendiente", status: "PENDING" });
    try {
        const result = await discoverWhatsappOrganizationCandidates(WA_ID);
        assert.equal(result.length, 1);
        assert.equal(result[0].name, "Cine Nadia");
    } finally {
        await cleanup({ organizationIds: [cine.id, pending.id], userIds: [owner.id] });
    }
});

// Revalidación de APPROVED también en el camino "ya vinculado" — una
// Organization pudo pasar a SUSPENDED/REJECTED después de vincularse.
testWithDb("a previously-linked organization that is no longer APPROVED is excluded from the result", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id, { name: "Cine Nadia", status: "SUSPENDED" });
    await prisma.whatsappOrganizerLink.create({ data: { waId: WA_ID, organizationId: org.id } });
    try {
        const result = await discoverWhatsappOrganizationCandidates(WA_ID);
        assert.deepEqual(result, []);
    } finally {
        await cleanup({ organizationIds: [org.id], userIds: [owner.id] });
    }
});

// Normalización — el mismo teléfono con distintos formatos de entrada debe
// coincidir igual (reutiliza normalizeArgentinePhoneForMatching, nunca una
// segunda normalización paralela).
testWithDb("phone matching tolerates different real-world formats (con código de país, con 9 de móvil, sin ninguno)", async () => {
    const owner = await createUser();
    const org = await createOrganization(owner.id, { name: "Cine Nadia", phone: "2984405532" });
    try {
        for (const waIdVariant of ["5492984405532", "542984405532", "02984405532", "2984405532"]) {
            const result = await discoverWhatsappOrganizationCandidates(waIdVariant);
            assert.equal(result.length, 1, `esperaba encontrar la organización para "${waIdVariant}"`);
            // Limpia el link creado por esta iteración para que la próxima
            // variante vuelva a pasar por el camino de descubrimiento.
            await prisma.whatsappOrganizerLink.deleteMany({ where: { organizationId: org.id } });
        }
    } finally {
        await cleanup({ organizationIds: [org.id], userIds: [owner.id] });
    }
});
