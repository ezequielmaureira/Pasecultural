// Conversión ÚNICA de las organizaciones eliminadas por su propietario con
// el mecanismo viejo (soft delete: closedAt != null + status SUSPENDED) al
// modelo nuevo: antecedente DeletedOrganization (DELETED_BY_USER) + hard
// delete real — exactamente el mismo camino que usa hoy "Eliminar
// organización" (organizationDeletion.service.js#hardDeleteOrganization).
//
// Cómo se distingue de una suspensión de Developer: SÓLO por closedAt.
// closedAt lo escribía únicamente deleteMyOrganizationService (autoservicio
// del propietario); updateOrganizationStatusService (Developer) nunca lo
// tocó. Una organización SUSPENDED con closedAt null nunca es candidata.
//
// Uso:
//   node scripts/convertClosedOrganizations.js
//       -> DRY RUN (por defecto). Sólo lecturas: lista las candidatas, sus
//          eventos y si tienen obligaciones vivas. No escribe nada.
//   node scripts/convertClosedOrganizations.js --apply --ids=<id1,id2>
//       -> convierte SÓLO esos ids, y sólo si siguen siendo candidatas
//          (closedAt != null) y no tienen obligaciones vivas. Cada una en
//          su propia transacción. Requiere la migración
//          20261007120000_deleted_organization_hard_delete ya aplicada.
//
// Nunca cambia el rol del User (si el propietario ya creó otra
// organización, sigue siendo ORGANIZER) ni toca Clerk.
import "dotenv/config";
import prisma from "../src/config/prisma.js";
import { findOrganizationDeletionBlockers, hardDeleteOrganization } from "../src/services/organizationDeletion.service.js";

function parseArgs(argv) {
    const apply = argv.includes("--apply");
    const idsArg = argv.find((a) => a.startsWith("--ids="));
    const ids = idsArg ? idsArg.slice("--ids=".length).split(",").map((s) => s.trim()).filter(Boolean) : [];
    return { apply, ids };
}

function describeDatabase() {
    try {
        const url = new URL(process.env.DATABASE_URL);
        return `${url.hostname}${url.pathname}`;
    } catch {
        return "(DATABASE_URL no parseable)";
    }
}

async function describeCandidate(organization, now) {
    const [owner, events, blockers] = await Promise.all([
        prisma.user.findUnique({
            where: { id: organization.ownerId },
            select: { id: true, email: true, firstName: true, lastName: true, role: true },
        }),
        prisma.event.findMany({
            where: { organizationId: organization.id },
            select: { id: true, title: true, _count: { select: { sales: true, tickets: true, withdrawalRequests: true } } },
        }),
        findOrganizationDeletionBlockers(prisma, organization.id, now),
    ]);
    const historical = events.filter((e) => e._count.sales + e._count.tickets + e._count.withdrawalRequests > 0);
    return {
        id: organization.id,
        name: organization.name,
        status: organization.status,
        plan: organization.plan,
        email: organization.email,
        createdAt: organization.createdAt.toISOString(),
        closedAt: organization.closedAt.toISOString(),
        owner: owner ? `${[owner.firstName, owner.lastName].filter(Boolean).join(" ")} <${owner.email}> (rol actual ${owner.role})` : "(sin User)",
        eventsTotal: events.length,
        eventsToArchive: historical.map((e) => `${e.title} [${e.id}] ventas=${e._count.sales} tickets=${e._count.tickets} solicitudes=${e._count.withdrawalRequests}`),
        eventsToDelete: events.length - historical.length,
        blockers,
        convertible: blockers.length === 0,
    };
}

async function main() {
    const { apply, ids } = parseArgs(process.argv.slice(2));
    const now = new Date();

    console.log(`Base: ${describeDatabase()}`);
    console.log(`Modo: ${apply ? "APPLY" : "DRY RUN (sólo lectura)"}`);

    const candidates = await prisma.organization.findMany({
        where: { closedAt: { not: null } },
        orderBy: { closedAt: "asc" },
    });

    if (!apply) {
        console.log(`Candidatas (closedAt != null): ${candidates.length}`);
        for (const organization of candidates) {
            console.log(JSON.stringify(await describeCandidate(organization, now), null, 2));
        }
        console.log("Dry run terminado. No se escribió nada.");
        return;
    }

    if (ids.length === 0) {
        throw new Error("--apply exige --ids=<id1,id2,...> explícitos (los del dry run).");
    }

    const byId = new Map(candidates.map((o) => [o.id, o]));
    for (const id of ids) {
        const organization = byId.get(id);
        if (!organization) {
            console.log(`SKIP ${id}: no existe o no tiene closedAt (no es una eliminación del propietario).`);
            continue;
        }
        const owner = await prisma.user.findUnique({ where: { id: organization.ownerId } });
        try {
            const result = await prisma.$transaction(
                (tx) => hardDeleteOrganization(tx, organization, owner, { reason: "DELETED_BY_USER", now, deletedAt: organization.closedAt }),
                { timeout: 30_000 }
            );
            console.log(
                `OK ${id} "${organization.name}" -> DeletedOrganization ${result.deletedOrganization.id}; ` +
                    `eventos borrados=${result.deletedEventIds.length}, archivados=${result.archivedEventIds.length}`
            );
        } catch (error) {
            const detail = error?.details ? ` ${JSON.stringify(error.details)}` : "";
            console.log(`FAIL ${id} "${organization.name}": ${error?.code ?? error?.message}${detail} (sin cambios, rollback)`);
            process.exitCode = 1;
        }
    }
}

main()
    .catch((err) => {
        console.error("convertClosedOrganizations: error inesperado", err);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
