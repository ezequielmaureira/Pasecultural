import prisma from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { logger } from "../logging/logger.js";

// Premium — Fase 2A, evolucionada por "Developer > Planes" (ver el informe
// de esa ronda). Módulo único y chico para todo lo relacionado a "qué
// puede hacer una Organization según su plan". Dos responsabilidades
// separadas en el mismo archivo (mismo criterio que
// developerAlertConfig.service.js: CRUD para Developer + lectura con
// fallback seguro para el resto del sistema):
//
//   1) Administración (Developer > Planes): leer/reemplazar la
//      configuración GENERAL de límites y features de cada plan.
//   2) Policy de lectura: resolver límites/features de una Organization
//      puntual, con fallback seguro. Esta policy NUNCA cuenta
//      eventos/scanners ni toca ninguna query de negocio — sólo resuelve
//      configuración. Contar y comparar es responsabilidad de cada
//      service de negocio (event.service.js, eventScanner.service.js).

const VALID_PLANS = new Set(["FREE", "PREMIUM"]);

// Campos numéricos que este SERVICE sigue validando/persistiendo tal cual
// (compatibilidad con el enforcement real de cortesías — courtesy.service.js/
// sale.service.js — y con los tests existentes que configuran
// maxCourtesiesPerEvent llamando a este mismo service). "Developer > Planes"
// (la pantalla) YA NO expone ni edita maxCourtesiesPerEvent: dejó de ser una
// de las 6 reglas de FREE/PREMIUM (ver el informe de la ronda) — el frontend
// simplemente no manda esa clave nunca más. Se deja disponible acá a
// propósito para no romper el enforcement real ni el resto del sistema que
// ya la consume.
const LIMIT_FIELDS = ["maxActiveEvents", "maxCourtesiesPerEvent", "maxActiveScanners", "maxTicketsPerEvent"];
const BOOLEAN_FIELDS = ["publicOrgPageEnabled", "whatsappEventCreationEnabled", "featuredEligible"];

const LIMIT_FIELD_LABELS = {
    maxActiveEvents: "El límite de eventos activos",
    maxCourtesiesPerEvent: "El límite de cortesías por evento",
    maxActiveScanners: "El límite de scanners activos",
    maxTicketsPerEvent: "El límite de entradas máximas por evento",
};

const BOOLEAN_FIELD_LABELS = {
    publicOrgPageEnabled: "Página pública propia",
    whatsappEventCreationEnabled: "Carga de eventos por WhatsApp",
    featuredEligible: "Puede ser organización destacada",
};

function serializeLimits(row) {
    return {
        plan: row.plan,
        maxActiveEvents: row.maxActiveEvents,
        maxCourtesiesPerEvent: row.maxCourtesiesPerEvent,
        maxActiveScanners: row.maxActiveScanners,
        maxTicketsPerEvent: row.maxTicketsPerEvent,
        publicOrgPageEnabled: row.publicOrgPageEnabled,
        whatsappEventCreationEnabled: row.whatsappEventCreationEnabled,
        featuredEligible: row.featuredEligible,
        updatedAt: row.updatedAt,
        updatedByUserId: row.updatedByUserId,
    };
}

// null = SIN LÍMITE / false = deshabilitado. Fallback si falta la fila de
// un plan (nunca debería pasar — la migración siembra las 2 — pero si
// alguna se borrara a mano, esto es lo que ve tanto la policy interna como,
// indirectamente, el panel Developer).
function fallbackLimits(plan) {
    return {
        plan,
        maxActiveEvents: null,
        maxCourtesiesPerEvent: null,
        maxActiveScanners: null,
        maxTicketsPerEvent: null,
        publicOrgPageEnabled: false,
        whatsappEventCreationEnabled: false,
        featuredEligible: false,
        updatedAt: null,
        updatedByUserId: null,
    };
}

// Validación PURA (nunca toca la base, nunca lanza) — mismo criterio que
// validateDeveloperAlertConfigInput/validateServiceFeeTiersInput. Cada
// campo numérico presente en el body debe ser: null (sin límite), o un
// entero >= 0. 0 es un valor legítimo ("no permitir altas nuevas") — nunca
// se trata como falsy/vacío. Cada campo booleano presente debe ser
// literalmente true/false. Campos ausentes del body simplemente no se
// tocan (PATCH parcial). Campos desconocidos (incluye
// maxCourtesiesPerEvent) se ignoran en silencio, misma convención que el
// resto del repo.
export function validatePlanLimitsInput(input) {
    const errors = [];
    const sanitized = {};

    for (const field of LIMIT_FIELDS) {
        if (!input || !Object.hasOwn(input, field)) continue;

        const raw = input[field];
        if (raw === null) {
            sanitized[field] = null;
            continue;
        }
        if (raw === "" || raw === undefined) {
            errors.push(`${LIMIT_FIELD_LABELS[field]} debe ser un número entero mayor o igual a 0, o "sin límite".`);
            continue;
        }

        const n = Number(raw);
        if (!Number.isInteger(n) || n < 0) {
            errors.push(`${LIMIT_FIELD_LABELS[field]} debe ser un número entero mayor o igual a 0, o "sin límite".`);
            continue;
        }
        sanitized[field] = n;
    }

    for (const field of BOOLEAN_FIELDS) {
        if (!input || !Object.hasOwn(input, field)) continue;

        const raw = input[field];
        if (typeof raw !== "boolean") {
            errors.push(`${BOOLEAN_FIELD_LABELS[field]} debe ser sí/no.`);
            continue;
        }
        sanitized[field] = raw;
    }

    if (errors.length > 0) return { valid: false, errors };
    return { valid: true, errors: [], sanitized };
}

// ---------------------------------------------------------------------
// Administración (Developer > Planes)
// ---------------------------------------------------------------------

// GET /api/developer/plan-limits — { FREE: {...}, PREMIUM: {...} }. Lanza
// (nunca en silencio) si falta alguna de las 2 filas — el panel Developer
// necesita saberlo explícito para poder recrearlas, mismo criterio que
// getDeveloperAlertConfigService/getPublicLaunchSettingsService.
export async function getAllPlanLimitsForDeveloperService() {
    const rows = await prisma.organizationPlanLimits.findMany({ orderBy: { plan: "asc" } });
    const byPlan = Object.fromEntries(rows.map((row) => [row.plan, serializeLimits(row)]));
    if (!byPlan.FREE || !byPlan.PREMIUM) {
        throw new AppError(ErrorCodes.PLAN_LIMITS_MISSING);
    }
    return byPlan;
}

// PATCH /api/developer/plan-limits/:plan — reemplaza (parcialmente) la
// configuración de UN plan. developerUserId ya resuelto por el controller
// (req.dbUser.id, ver requireRole) — mismo criterio que
// replaceDeveloperAlertConfigService/updateServiceFeeConfigService.
export async function updatePlanLimitsService(plan, developerUserId, input) {
    if (!VALID_PLANS.has(plan)) {
        throw new AppError(ErrorCodes.PLAN_LIMITS_INVALID_PLAN);
    }

    const { valid, errors, sanitized } = validatePlanLimitsInput(input);
    if (!valid) throw new AppError(ErrorCodes.PLAN_LIMITS_INVALID, { details: errors });

    const existing = await prisma.organizationPlanLimits.findUnique({ where: { plan } });
    const row = existing
        ? await prisma.organizationPlanLimits.update({
              where: { plan },
              data: { ...sanitized, updatedByUserId: developerUserId },
          })
        : await prisma.organizationPlanLimits.create({
              data: {
                  plan,
                  maxActiveEvents: null,
                  maxCourtesiesPerEvent: null,
                  maxActiveScanners: null,
                  maxTicketsPerEvent: null,
                  publicOrgPageEnabled: false,
                  whatsappEventCreationEnabled: false,
                  featuredEligible: false,
                  ...sanitized,
                  updatedByUserId: developerUserId,
              },
          });

    logger.info("organization plan limits updated", { plan, updatedByUserId: developerUserId });
    return serializeLimits(row);
}

// ---------------------------------------------------------------------
// Policy de lectura — consumida por guards de negocio. NUNCA lanza: una
// configuración que no se puede leer no puede romper la operación de
// negocio que la consulta, cae al fallback seguro (mismo criterio que
// getDeveloperAlertConfigOrDefaults/isPublicLaunchEnabledOrDefault).
// ---------------------------------------------------------------------

// Features booleanas por plan, ahora 100% configurables desde Developer >
// Planes (antes: hardcodeadas a "sólo PREMIUM" — ver el informe de la
// ronda "Developer > Planes"). FEATURED_ELIGIBLE está acá por consistencia
// de forma (misma función genérica isFeatureAvailable), pero todavía no
// tiene ningún guard/consumidor real en el resto del sistema — sólo se
// configura en esta ronda (ver el informe: elegibilidad del PLAN, nunca
// el toggle individual de una Organization puntual).
export const PremiumFeature = Object.freeze({
    WHATSAPP_EVENT_CREATION: "WHATSAPP_EVENT_CREATION",
    PUBLIC_ORGANIZATION_PAGE: "PUBLIC_ORGANIZATION_PAGE",
    FEATURED_ELIGIBLE: "FEATURED_ELIGIBLE",
});

const FEATURE_FIELD_BY_KEY = {
    [PremiumFeature.WHATSAPP_EVENT_CREATION]: "whatsappEventCreationEnabled",
    [PremiumFeature.PUBLIC_ORGANIZATION_PAGE]: "publicOrgPageEnabled",
    [PremiumFeature.FEATURED_ELIGIBLE]: "featuredEligible",
};

// Claves de límites configurables desde Developer (ver
// OrganizationPlanLimits) — dependen de configuración editable, NUNCA
// hardcodeadas a un plan: FREE podría eventualmente tener "sin límite" en
// algún campo, y viceversa.
export const PlanLimitKey = Object.freeze({
    ACTIVE_EVENTS: "ACTIVE_EVENTS",
    // Sigue en uso real por sale.service.js (issueCourtesyService) — ya no
    // es editable desde Developer > Planes (ver LIMIT_FIELDS más arriba),
    // pero el enforcement existente no se toca.
    COURTESIES_PER_EVENT: "COURTESIES_PER_EVENT",
    // Scanners ACTIVOS de la ORGANIZACIÓN — no por evento (renombrado
    // desde SCANNERS_PER_EVENT, ver el informe de la ronda "Developer >
    // Planes": el campo/enforcement anterior modelaba mal la regla real).
    ACTIVE_SCANNERS: "ACTIVE_SCANNERS",
    // Configurado desde esta ronda; todavía SIN ningún guard/consumidor
    // real (ver el informe: "configurada pero pendiente de enforcement").
    MAX_TICKETS_PER_EVENT: "MAX_TICKETS_PER_EVENT",
});

const LIMIT_FIELD_BY_KEY = {
    [PlanLimitKey.ACTIVE_EVENTS]: "maxActiveEvents",
    [PlanLimitKey.COURTESIES_PER_EVENT]: "maxCourtesiesPerEvent",
    [PlanLimitKey.ACTIVE_SCANNERS]: "maxActiveScanners",
    [PlanLimitKey.MAX_TICKETS_PER_EVENT]: "maxTicketsPerEvent",
};

// Lectura cruda de la fila de UN plan (FREE o PREMIUM) — nunca lanza.
export async function getPlanLimits(plan) {
    try {
        const row = await prisma.organizationPlanLimits.findUnique({ where: { plan } });
        if (!row) {
            logger.warn("organizationPlanPolicy: no hay OrganizationPlanLimits para este plan, usando fallback sin límite", { plan });
            return fallbackLimits(plan);
        }
        return serializeLimits(row);
    } catch (err) {
        logger.error(err, { context: "organizationPlanPolicy: no se pudo leer OrganizationPlanLimits, usando fallback sin límite", plan });
        return fallbackLimits(plan);
    }
}

// Conveniencia: resuelve la configuración a partir de una Organization ya
// cargada (usa organization.plan, default FREE si no viene).
export async function getOrganizationPlanLimits(organization) {
    return getPlanLimits(organization?.plan ?? "FREE");
}

export function isPremium(organization) {
    return organization?.plan === "PREMIUM";
}

// Fuente de verdad real para gating de features por plan — lee la
// configuración persistida (Developer > Planes), NUNCA vuelve a
// hardcodear "sólo PREMIUM". organization.plan resuelve la fila a leer;
// si no hay configuración legible, fallbackLimits() devuelve false para
// toda feature (fail-safe: nunca habilita algo por accidente si la config
// no se pudo leer).
export async function isFeatureAvailable(organization, feature) {
    const field = FEATURE_FIELD_BY_KEY[feature];
    if (!field) {
        throw new Error(`organizationPlanPolicy: feature desconocida "${feature}"`);
    }
    const limits = await getOrganizationPlanLimits(organization);
    return limits[field] === true;
}

// null = sin límite (ilimitado) — nunca -1/Infinity. limitKey debe ser
// una de PlanLimitKey.
export async function getLimitForOrganization(organization, limitKey) {
    const field = LIMIT_FIELD_BY_KEY[limitKey];
    if (!field) {
        throw new Error(`organizationPlanPolicy: limitKey desconocida "${limitKey}"`);
    }
    const limits = await getOrganizationPlanLimits(organization);
    return limits[field];
}
