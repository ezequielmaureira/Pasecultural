import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import { syncUserService } from "../src/services/auth.service.js";

// Sync de usuarios de Clerk — adopción de compras de invitado y rol
// DEVELOPER sólo con email verificado. Postgres real.
import { hasDatabase } from "./helpers/dbGuard.js";
const testWithDb = hasDatabase ? test : test.skip;

const suffix = () => randomUUID().slice(0, 8);

testWithDb("AUTH-A: email SIN verificar que coincide con un invitado => 403, el invitado queda intacto", async () => {
    const email = `guest_${suffix()}@example.com`;
    const guest = await prisma.user.create({ data: { email, firstName: "Ana" } });
    try {
        await assert.rejects(syncUserService({ clerkId: `clerk_${suffix()}`, email, emailVerified: false }), (e) => e.code === "AUTH_EMAIL_NOT_VERIFIED");
        assert.equal((await prisma.user.findUnique({ where: { id: guest.id } })).clerkId, null);
    } finally {
        await prisma.user.deleteMany({ where: { email } });
    }
});

testWithDb("AUTH-B: email verificado (aunque venga con mayúsculas) adopta las compras de invitado", async () => {
    const email = `guest_${suffix()}@example.com`;
    const guest = await prisma.user.create({ data: { email, firstName: "Ana" } });
    const clerkId = `clerk_${suffix()}`;
    try {
        const synced = await syncUserService({ clerkId, email: `  ${email.toUpperCase()} `, emailVerified: true });
        assert.equal(synced.id, guest.id);
        assert.equal((await prisma.user.findUnique({ where: { id: guest.id } })).clerkId, clerkId);
    } finally {
        await prisma.user.deleteMany({ where: { email } });
    }
});

testWithDb("AUTH-C: el email de Developer sin verificar nunca recibe el rol DEVELOPER", async () => {
    const existing = await prisma.user.findUnique({ where: { email: "ezequiel.maureira@gmail.com" } });
    if (existing) return; // base con datos reales del developer: nada que probar sin tocarlos
    const clerkId = `clerk_${suffix()}`;
    try {
        const synced = await syncUserService({ clerkId, email: "ezequiel.maureira@gmail.com", emailVerified: false });
        assert.equal(synced.role, "CUSTOMER");
    } finally {
        await prisma.user.deleteMany({ where: { clerkId } });
    }
});

testWithDb("AUTH-D: el email de Developer verificado sí recibe DEVELOPER", async () => {
    const existing = await prisma.user.findUnique({ where: { email: "ezequiel.maureira@gmail.com" } });
    if (existing) return;
    const clerkId = `clerk_${suffix()}`;
    try {
        const synced = await syncUserService({ clerkId, email: "Ezequiel.Maureira@gmail.com", emailVerified: true });
        assert.equal(synced.role, "DEVELOPER");
    } finally {
        await prisma.user.deleteMany({ where: { clerkId } });
    }
});

testWithDb("AUTH-E: usuario nuevo sin invitado previo y sin verificar => CUSTOMER normal", async () => {
    const clerkId = `clerk_${suffix()}`;
    const email = `new_${suffix()}@example.com`;
    try {
        const synced = await syncUserService({ clerkId, email, emailVerified: false });
        assert.equal(synced.role, "CUSTOMER");
        assert.equal(synced.email, email);
    } finally {
        await prisma.user.deleteMany({ where: { clerkId } });
    }
});
