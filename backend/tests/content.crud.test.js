import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/config/prisma.js";
import { getContentCardService, updateContentCardService, getPublicContentCardService } from "../src/services/content.service.js";
import {
    getFestPassIntroContent,
    updateFestPassIntroContent,
    getPublicFestPassIntroContent,
    getHowItWorksContent,
    updateHowItWorksContent,
    getPublicHowItWorksContent,
} from "../src/controllers/content.controller.js";
import { requireRole } from "../src/middlewares/requireRole.js";

// Developer > Contenido (V1 mínima) — CRUD real contra Postgres real
// (backend/.env.test), mismo criterio que developerServiceFee.service.test.js
// / developerAlertConfig.crud.test.js. Guardrail centralizado — ver
// tests/helpers/dbGuard.js.
import { hasDatabase } from "./helpers/dbGuard.js";
const testWithDb = hasDatabase ? test : test.skip;

const PLACEMENT = "ORGANIZER_FEST_PASS_INTRO";
const ATTENDEES_PLACEMENT = "HOW_IT_WORKS_ATTENDEES";
const ORGANIZERS_PLACEMENT = "HOW_IT_WORKS_ORGANIZERS";
const SCANNERS_PLACEMENT = "HOW_IT_WORKS_SCANNERS";

function uniqueSuffix() {
    return randomUUID().slice(0, 8);
}

async function createUser(overrides = {}) {
    const suffix = uniqueSuffix();
    return prisma.user.create({
        data: { clerkId: `clerk_${suffix}`, email: `user_${suffix}@example.com`, firstName: "Nadia", role: "ORGANIZER", ...overrides },
    });
}

async function cleanup({ userIds = [] }) {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

function fakeRes() {
    const state = {};
    const res = {
        status(code) {
            state.statusCode = code;
            return res;
        },
        json(body) {
            state.jsonBody = body;
            return res;
        },
    };
    return { res, state };
}

function fakeReqWithAuth(clerkId) {
    const req = { headers: {}, body: {} };
    req.auth = Object.assign(() => ({ userId: clerkId, tokenType: "session_token" }), {
        [Symbol.for("@clerk/express.auth")]: true,
    });
    return req;
}

async function resetCard() {
    await prisma.contentCard.deleteMany({ where: { placement: PLACEMENT } });
}

async function resetHowItWorksCards() {
    await prisma.contentCard.deleteMany({
        where: { placement: { in: [ATTENDEES_PLACEMENT, ORGANIZERS_PLACEMENT, SCANNERS_PLACEMENT] } },
    });
}

testWithDb("a DEVELOPER can read the config via the controller", async () => {
    await resetCard();
    const developer = await createUser({ role: "DEVELOPER" });
    try {
        const req = fakeReqWithAuth(developer.clerkId);
        await requireRole("DEVELOPER")(req, fakeRes().res, () => {});
        const { res, state } = fakeRes();
        await getFestPassIntroContent(req, res, () => {});
        assert.equal(state.statusCode, 200);
        assert.equal(state.jsonBody.placement, PLACEMENT);
        assert.equal(state.jsonBody.active, false);
    } finally {
        await cleanup({ userIds: [developer.id] });
        await resetCard();
    }
});

testWithDb("a DEVELOPER can update the image and activate the card, and GET reflects it immediately", async () => {
    await resetCard();
    const developer = await createUser({ role: "DEVELOPER" });
    try {
        const req = fakeReqWithAuth(developer.clerkId);
        await requireRole("DEVELOPER")(req, fakeRes().res, () => {});
        req.body = { imageUrl: "https://res.cloudinary.com/demo/image/upload/festpass.png", active: true };
        const { res, state } = fakeRes();
        await updateFestPassIntroContent(req, res, () => {});

        assert.equal(state.statusCode, 200);
        assert.equal(state.jsonBody.active, true);
        assert.equal(state.jsonBody.imageUrl, "https://res.cloudinary.com/demo/image/upload/festpass.png");

        const getReq = fakeReqWithAuth(developer.clerkId);
        const getRes = fakeRes();
        await getFestPassIntroContent(getReq, getRes.res, () => {});
        assert.equal(getRes.state.jsonBody.active, true);
    } finally {
        await cleanup({ userIds: [developer.id] });
        await resetCard();
    }
});

testWithDb("a DEVELOPER can deactivate the card without providing an image", async () => {
    await resetCard();
    const developer = await createUser({ role: "DEVELOPER" });
    try {
        await updateContentCardService(PLACEMENT, { imageUrl: "https://example.com/a.png", active: true });
        const result = await updateContentCardService(PLACEMENT, { imageUrl: "https://example.com/a.png", active: false });
        assert.equal(result.active, false);
    } finally {
        await cleanup({ userIds: [developer.id] });
        await resetCard();
    }
});

testWithDb("requireRole('DEVELOPER') blocks an ORGANIZER from writing the config", async () => {
    const organizer = await createUser({ role: "ORGANIZER" });
    try {
        const req = fakeReqWithAuth(organizer.clerkId);
        const { res, state } = fakeRes();
        let nextCalled = false;
        await requireRole("DEVELOPER")(req, res, () => {
            nextCalled = true;
        });
        assert.equal(nextCalled, false);
        assert.equal(state.statusCode, 403);
    } finally {
        await cleanup({ userIds: [organizer.id] });
    }
});

testWithDb("active=true without an imageUrl is rejected", async () => {
    await resetCard();
    await assert.rejects(
        () => updateContentCardService(PLACEMENT, { imageUrl: null, active: true }),
        (error) => {
            assert.equal(error.code, "CONTENT_CARD_INVALID");
            return true;
        }
    );
    const stored = await getContentCardService(PLACEMENT);
    assert.equal(stored, null);
});

testWithDb("active without a real boolean is rejected", async () => {
    await resetCard();
    await assert.rejects(
        () => updateContentCardService(PLACEMENT, { imageUrl: "https://example.com/a.png", active: "yes" }),
        (error) => {
            assert.equal(error.code, "CONTENT_CARD_INVALID");
            return true;
        }
    );
});

testWithDb("the public endpoint returns the active image", async () => {
    await resetCard();
    try {
        await updateContentCardService(PLACEMENT, { imageUrl: "https://example.com/festpass.png", active: true });
        const req = {};
        const { res, state } = fakeRes();
        await getPublicFestPassIntroContent(req, res, () => {});
        assert.equal(state.statusCode, 200);
        assert.deepEqual(state.jsonBody, { active: true, imageUrl: "https://example.com/festpass.png" });
    } finally {
        await resetCard();
    }
});

testWithDb("the public endpoint returns active:false when the card is inactive", async () => {
    await resetCard();
    try {
        await updateContentCardService(PLACEMENT, { imageUrl: "https://example.com/festpass.png", active: false });
        const result = await getPublicContentCardService(PLACEMENT);
        assert.deepEqual(result, { active: false, imageUrl: null });
    } finally {
        await resetCard();
    }
});

testWithDb("the public endpoint returns active:false when no configuration exists", async () => {
    await resetCard();
    const result = await getPublicContentCardService(PLACEMENT);
    assert.deepEqual(result, { active: false, imageUrl: null });
});

// ¿Cómo funciona? — pestañas asistentes/organizadores (HOW_IT_WORKS_ATTENDEES
// / HOW_IT_WORKS_ORGANIZERS), reutilizando el mismo ContentCard genérico.

testWithDb("a DEVELOPER can read the three how-it-works configs via the controller", async () => {
    await resetHowItWorksCards();
    const developer = await createUser({ role: "DEVELOPER" });
    try {
        const req = fakeReqWithAuth(developer.clerkId);
        const { res, state } = fakeRes();
        await getHowItWorksContent(req, res, () => {});
        assert.equal(state.statusCode, 200);
        assert.equal(state.jsonBody.attendees.placement, ATTENDEES_PLACEMENT);
        assert.equal(state.jsonBody.attendees.active, false);
        assert.equal(state.jsonBody.organizers.placement, ORGANIZERS_PLACEMENT);
        assert.equal(state.jsonBody.organizers.active, false);
        assert.equal(state.jsonBody.scanners.placement, SCANNERS_PLACEMENT);
        assert.equal(state.jsonBody.scanners.active, false);
    } finally {
        await cleanup({ userIds: [developer.id] });
        await resetHowItWorksCards();
    }
});

testWithDb("a DEVELOPER can update the three how-it-works images in one call", async () => {
    await resetHowItWorksCards();
    const developer = await createUser({ role: "DEVELOPER" });
    try {
        const req = fakeReqWithAuth(developer.clerkId);
        req.body = {
            attendees: { imageUrl: "https://example.com/attendees.png", active: true },
            organizers: { imageUrl: "https://example.com/organizers.png", active: true },
            scanners: { imageUrl: "https://example.com/scanners.png", active: true },
        };
        const { res, state } = fakeRes();
        await updateHowItWorksContent(req, res, () => {});

        assert.equal(state.statusCode, 200);
        assert.equal(state.jsonBody.attendees.imageUrl, "https://example.com/attendees.png");
        assert.equal(state.jsonBody.organizers.imageUrl, "https://example.com/organizers.png");
        assert.equal(state.jsonBody.scanners.imageUrl, "https://example.com/scanners.png");

        const getReq = fakeReqWithAuth(developer.clerkId);
        const getRes = fakeRes();
        await getHowItWorksContent(getReq, getRes.res, () => {});
        assert.equal(getRes.state.jsonBody.attendees.active, true);
        assert.equal(getRes.state.jsonBody.organizers.active, true);
        assert.equal(getRes.state.jsonBody.scanners.active, true);
    } finally {
        await cleanup({ userIds: [developer.id] });
        await resetHowItWorksCards();
    }
});

testWithDb("the public how-it-works endpoint only exposes active/imageUrl per tab, including scanners", async () => {
    await resetHowItWorksCards();
    try {
        await updateContentCardService(ATTENDEES_PLACEMENT, { imageUrl: "https://example.com/attendees.png", active: true });
        await updateContentCardService(ORGANIZERS_PLACEMENT, { imageUrl: "https://example.com/organizers.png", active: false });
        await updateContentCardService(SCANNERS_PLACEMENT, { imageUrl: "https://example.com/scanners.png", active: true });

        const req = {};
        const { res, state } = fakeRes();
        await getPublicHowItWorksContent(req, res, () => {});
        assert.equal(state.statusCode, 200);
        assert.deepEqual(state.jsonBody, {
            attendees: { active: true, imageUrl: "https://example.com/attendees.png" },
            organizers: { active: false, imageUrl: null },
            scanners: { active: true, imageUrl: "https://example.com/scanners.png" },
        });
    } finally {
        await resetHowItWorksCards();
    }
});

testWithDb("the public how-it-works endpoint returns a safe state when nothing is configured", async () => {
    await resetHowItWorksCards();
    const req = {};
    const { res, state } = fakeRes();
    await getPublicHowItWorksContent(req, res, () => {});
    assert.equal(state.statusCode, 200);
    assert.deepEqual(state.jsonBody, {
        attendees: { active: false, imageUrl: null },
        organizers: { active: false, imageUrl: null },
        scanners: { active: false, imageUrl: null },
    });
});

testWithDb("scanners without configuration returns active:false and imageUrl:null on its own", async () => {
    await resetHowItWorksCards();
    try {
        await updateContentCardService(ATTENDEES_PLACEMENT, { imageUrl: "https://example.com/attendees.png", active: true });
        await updateContentCardService(ORGANIZERS_PLACEMENT, { imageUrl: "https://example.com/organizers.png", active: true });

        const result = await getPublicContentCardService(SCANNERS_PLACEMENT);
        assert.deepEqual(result, { active: false, imageUrl: null });
    } finally {
        await resetHowItWorksCards();
    }
});

testWithDb("Fest Pass intro is unaffected by how-it-works reads/writes", async () => {
    await resetCard();
    await resetHowItWorksCards();
    try {
        await updateContentCardService(PLACEMENT, { imageUrl: "https://example.com/festpass.png", active: true });
        await updateContentCardService(ATTENDEES_PLACEMENT, { imageUrl: "https://example.com/attendees.png", active: true });

        const festPass = await getPublicContentCardService(PLACEMENT);
        assert.deepEqual(festPass, { active: true, imageUrl: "https://example.com/festpass.png" });
    } finally {
        await resetCard();
        await resetHowItWorksCards();
    }
});
