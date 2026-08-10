import prisma from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { getUserByClerkId } from "../utils/getUserByClerkId.js";
import { generateVerificationCode, hashVerificationCode } from "../utils/verificationCode.js";
import { logger } from "../logging/logger.js";

// Fase 2F — vinculación segura wa_id ↔ Organizer. Mismos parámetros que el
// resto de los flujos de código de 6 dígitos de la app (scannerInvitation,
// saleRecoveryVerification): 10 minutos de vigencia, 5 intentos, 1 minuto
// de cooldown entre reenvíos.
const CODE_EXPIRY_MS = 10 * 60 * 1000;
const MAX_LINK_ATTEMPTS = 5;
const CHALLENGE_RESEND_COOLDOWN_MS = 60 * 1000;

// ==================================================================
// Funciones puras — testeables sin Prisma, mismo criterio que
// buildBulkTicketActionPlan en ticketAdmin.service.js: reciben datos ya
// leídos (o null) y sólo deciden, nunca hacen I/O.
// ==================================================================

// El frontend nunca manda waId (sección 2D del pedido), así que la
// verificación no puede buscar "el challenge de este waId" — busca por
// hash del código (ver linkWhatsappOrganizerService). Esta función sólo
// interpreta lo que esa búsqueda encontró.
export function evaluateWhatsappLinkChallengeLookup({ challenge, now }) {
    if (!challenge) return { status: "NOT_FOUND" };
    if (challenge.expiresAt < now) return { status: "EXPIRED" };
    return { status: "VALID" };
}

// Como un código que NO matchea ningún hash no señala ninguna fila
// puntual a la que culpar, los intentos fallidos se cuentan sobre la
// ORGANIZACIÓN autenticada que está verificando (Organization.
// whatsappLinkAttempts/whatsappLinkAttemptsAt), no sobre el challenge.
// La ventana se autolimpia sola (mismo criterio de expiración de 10
// minutos que el propio código) — no hay bloqueo permanente.
export function evaluateOrganizationLinkAttempts({ failedAttempts, windowStartedAt, now, maxAttempts = MAX_LINK_ATTEMPTS, windowMs = CODE_EXPIRY_MS }) {
    const withinWindow = Boolean(windowStartedAt) && now.getTime() - windowStartedAt.getTime() < windowMs;
    const effectiveAttempts = withinWindow ? failedAttempts : 0;
    return { blocked: effectiveAttempts >= maxAttempts, effectiveAttempts };
}

// Decide si corresponde generar un código nuevo para este wa_id o si hay
// que esperar (challenge todavía vigente y dentro del cooldown de
// reenvío) — el código en texto plano nunca se persiste, así que no hay
// forma de "reenviar el mismo": la única alternativa seria es
// reemplazar bajo cooldown (ver sección 5 del pedido).
export function shouldCreateNewChallenge({ existing, now, cooldownMs = CHALLENGE_RESEND_COOLDOWN_MS }) {
    if (!existing) return true;
    if (existing.expiresAt < now) return true;
    return now.getTime() - existing.lastSentAt.getTime() >= cooldownMs;
}

// ==================================================================
// Generación del challenge — llamada desde whatsapp.controller.js cuando
// intent=AFFIRMATIVE y resolveWhatsappOrganizerIdentity(waId) === null.
// ==================================================================

// CAS real vía updateMany+WHERE (mismo patrón que claimVerificationCodeSend
// en scannerInvitation.service.js): sólo reemplaza si la fila existe y ya
// se puede (venció o pasó el cooldown). Si no matcheó ninguna fila, puede
// ser porque nunca existió (create) o porque sigue vigente y en cooldown
// (el create() de abajo choca con waId @unique y se interpreta como
// "pending", nunca como error).
async function claimChallengeReplacement(waId, now) {
    const cooldownBefore = new Date(now.getTime() - CHALLENGE_RESEND_COOLDOWN_MS);
    const code = generateVerificationCode();
    const codeFields = {
        codeHash: hashVerificationCode(code),
        expiresAt: new Date(now.getTime() + CODE_EXPIRY_MS),
        lastSentAt: now,
    };

    const replaced = await prisma.whatsappLinkChallenge.updateMany({
        where: { waId, OR: [{ lastSentAt: { lt: cooldownBefore } }, { expiresAt: { lt: now } }] },
        data: codeFields,
    });
    if (replaced.count === 1) return code;

    try {
        await prisma.whatsappLinkChallenge.create({ data: { waId, ...codeFields } });
        return code;
    } catch (error) {
        if (error.code === "P2002") return null; // fila ya existe y el cooldown sigue activo
        throw error;
    }
}

// Devuelve { code } (recién generado, sólo esta vez en texto plano) o
// { pending: true } si ya había un challenge vigente y en cooldown — el
// caller (whatsapp.controller.js) decide qué mensaje mandar en cada caso.
export async function createOrReuseWhatsappLinkChallenge(waId) {
    const now = new Date();
    const code = await claimChallengeReplacement(waId, now);
    logger.info("whatsapp link challenge", { challengeCreated: Boolean(code) });
    return code ? { code } : { pending: true };
}

// ==================================================================
// Verificación desde el panel Organizer — POST /api/organizations/me/whatsapp-link
// ==================================================================

async function resolveOwnOrganizationOrThrow(clerkId) {
    const user = await getUserByClerkId(clerkId);
    if (!user) throw new AppError(ErrorCodes.USER_NOT_FOUND);

    const organization = await prisma.organization.findFirst({ where: { ownerId: user.id } });
    if (!organization) throw new AppError(ErrorCodes.WHATSAPP_LINK_NO_ORGANIZATION);

    return organization;
}

async function registerFailedLinkAttempt(organization, now) {
    const { effectiveAttempts } = evaluateOrganizationLinkAttempts({
        failedAttempts: organization.whatsappLinkAttempts,
        windowStartedAt: organization.whatsappLinkAttemptsAt,
        now,
    });
    const startingNewWindow = effectiveAttempts === 0;

    // Best-effort: si esto falla, el código igual se rechaza — no vale la
    // pena convertir un problema de contador en un 500 para el organizador.
    await prisma.organization
        .update({
            where: { id: organization.id },
            data: {
                whatsappLinkAttempts: effectiveAttempts + 1,
                whatsappLinkAttemptsAt: startingNewWindow ? now : organization.whatsappLinkAttemptsAt,
            },
        })
        .catch(() => {});
}

// El código es la ÚNICA prueba de identidad (nunca waId/organizationId
// desde el cliente, sección 2D/6 del pedido) — se busca el challenge por
// el HASH del código enviado. Es una búsqueda exacta (no hay comparación
// insegura: SHA-256 es determinístico, así que sólo el código correcto
// puede producir ese hash) — no hace falta timing-safe acá porque no se
// compara byte a byte contra un valor conocido en memoria de proceso.
export async function linkWhatsappOrganizerService(clerkId, rawCode) {
    const code = String(rawCode ?? "").trim();
    if (!code) throw new AppError(ErrorCodes.WHATSAPP_LINK_CODE_REQUIRED);

    const organization = await resolveOwnOrganizationOrThrow(clerkId);
    const now = new Date();

    const { blocked } = evaluateOrganizationLinkAttempts({
        failedAttempts: organization.whatsappLinkAttempts,
        windowStartedAt: organization.whatsappLinkAttemptsAt,
        now,
    });
    if (blocked) throw new AppError(ErrorCodes.WHATSAPP_LINK_TOO_MANY_ATTEMPTS);

    const existingOwnLink = await prisma.whatsappOrganizerLink.findUnique({ where: { organizationId: organization.id } });
    if (existingOwnLink) throw new AppError(ErrorCodes.WHATSAPP_ALREADY_LINKED);

    const codeHash = hashVerificationCode(code);
    const challenge = await prisma.whatsappLinkChallenge.findFirst({ where: { codeHash } });
    const lookup = evaluateWhatsappLinkChallengeLookup({ challenge, now });

    if (lookup.status !== "VALID") {
        await registerFailedLinkAttempt(organization, now);
        throw new AppError(lookup.status === "EXPIRED" ? ErrorCodes.WHATSAPP_LINK_CODE_EXPIRED : ErrorCodes.WHATSAPP_LINK_CODE_INVALID);
    }

    try {
        await prisma.$transaction(async (tx) => {
            await tx.whatsappOrganizerLink.create({
                data: { waId: challenge.waId, organizationId: organization.id },
            });
            await tx.whatsappLinkChallenge.delete({ where: { id: challenge.id } });
            await tx.organization.update({
                where: { id: organization.id },
                data: { whatsappLinkAttempts: 0, whatsappLinkAttemptsAt: null },
            });
        });
    } catch (error) {
        if (error.code === "P2002") {
            // Carrera real (rarísima): el waId quedó vinculado a otra
            // organización entre el findFirst de arriba y este commit.
            // Nunca se reasigna.
            logger.warn("whatsapp organizer link: conflicto de waId al vincular", { linkSuccess: false, reason: "WAID_ALREADY_LINKED" });
            throw new AppError(ErrorCodes.WHATSAPP_LINK_WAID_ALREADY_LINKED);
        }
        throw error;
    }

    logger.info("whatsapp organizer link created", { linkSuccess: true });
    return { linked: true };
}

// GET /api/organizations/me/whatsapp-link — nunca devuelve waId completo
// (sección 9 del pedido): sólo si hay vínculo y desde cuándo.
export async function getWhatsappLinkStatusService(clerkId) {
    const organization = await resolveOwnOrganizationOrThrow(clerkId);

    const link = await prisma.whatsappOrganizerLink.findUnique({
        where: { organizationId: organization.id },
        select: { verifiedAt: true },
    });

    return { linked: Boolean(link), verifiedAt: link?.verifiedAt ?? null };
}
