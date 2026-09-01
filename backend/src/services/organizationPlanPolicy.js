import prisma from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { logger } from "../logging/logger.js";

// Premium — Fase 2A. Módulo único y chico para todo lo relacionado a
// "qué puede hacer una Organization según su plan" — ver el informe de
// auditoría/entrega. Dos responsabilidades separadas en el mismo archivo
// (mismo criterio que developerAlertConfig.service.js: CRUD para
// Developer + lectura con fallback seguro para el resto del sistema):
//
//   1) Administración (Developer > Configuración): leer/reemplazar la
//      configuración GENERAL de límites de cada plan.
//   2) Policy de lectura (consumida por guards de una fase posterior —
//      Fase 2B/2C/2D — NINGUNO activo todavía en esta ronda): resolver
//      límites/features de una Organization puntual, con fallback seguro.
//
// Esta policy NUNCA cuenta eventos/cortesías/scanners ni toca ninguna
// query de negocio — sólo resuelve configuración. Contar y comparar es
// responsabilidad de cada service de negocio en la fase que los aplique.

const VALID_PLANS = new Set(["FREE", "PREMIUM"]);

const LIMIT_FIELDS = ["maxActiveEvents", "maxCourtesiesPerEvent", "maxScannersPerEvent"];

const LIMIT_FIELD_LABELS = {
    maxActiveEvents: "El límite de eventos activos",
    maxCourtesiesPerEvent: "El límite de cortesías por evento",
    maxScannersPerEvent: "El límite de scanners por evento",
};

function serializeLimits(row) {
    return {
        plan: row.plan,
        maxActiveEvents: row.maxActiveEvents,
        maxCourtesiesPerEvent: row.maxCourtesiesPerEvent,
        maxScannersPerEvent: row.maxScannersPerEvent,
        updatedAt: row.updatedAt,
        updatedByUserId: row.updatedByUserId,
    };
}

// null = SIN LÍMITE. Fallback si falta la fila de un plan (nunca debería
// pasar — la migración siembra las 2 — pero si alguna se borrara a mano,
// esto es lo que ve tanto la policy interna como, indirectamente, el
// panel Developer).
function fallbackLimits(plan) {
    return { plan, maxActiveEvents: null, maxCourtesiesPerEvent: null, maxScannersPerEvent: null, updatedAt: null, updatedByUserId: null };
}

// Validación PURA (nunca toca la base, nunca lanza) — mismo criterio que
// validateDeveloperAlertConfigInput/validateServiceFeeTiersInput. Cada
// campo presente en el body debe ser: null (sin límite), o un entero >= 0.
// 0 es un valor legítimo ("no permitir altas nuevas") — nunca se trata
// como falsy/vacío. Campos ausentes del body simplemente no se tocan
// (PATCH parcial, mismo criterio que updateMyOrganizationService).
// Campos desconocidos del body se ignoran en silencio — no existe en todo
// el repo ningún endpoint que "rechace" un campo extra con error (ver el
// informe de entrega para la evidencia), así que esta validación sigue
// esa misma convención en vez de inventar una nueva.
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

    if (errors.length > 0) return { valid: false, errors };
    return { valid: true, errors: [], sanitized };
}

// ---------------------------------------------------------------------
// Administración (Developer > Configuración)
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

// PATCH /api/developer/plan-limits/:plan — reemplaza (parcialmente) los
// límites de UN plan. developerUserId ya resuelto por el controller
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
                  maxScannersPerEvent: null,
                  ...sanitized,
                  updatedByUserId: developerUserId,
              },
          });

    logger.info("organization plan limits updated", { plan, updatedByUserId: developerUserId });
    return serializeLimits(row);
}

// ---------------------------------------------------------------------
// Policy de lectura — consumida por guards de una fase posterior. NUNCA
// lanza: una configuración que no se puede leer no puede romper la
// operación de negocio que la consulta, cae al fallback seguro (mismo
// criterio que getDeveloperAlertConfigOrDefaults/
// isPublicLaunchEnabledOrDefault).
// ---------------------------------------------------------------------

// Features que van a exigir PREMIUM — todavía SIN ningún guard activo en
// esta ronda (Fase 2A es sólo infraestructura). Constantes centralizadas
// para que el código futuro las importe de acá, nunca strings sueltos
// repetidos por el repo.
export const PremiumFeature = Object.freeze({
    WHATSAPP_EVENT_CREATION: "WHATSAPP_EVENT_CREATION",
    PUBLIC_ORGANIZATION_PAGE: "PUBLIC_ORGANIZATION_PAGE",
});

// Claves de límites configurables desde Developer (ver
// OrganizationPlanLimits) — dependen de configuración editable, NUNCA
// hardcodeadas a un plan: FREE podría eventualmente tener "sin límite" en
// algún campo, y viceversa.
export const PlanLimitKey = Object.freeze({
    ACTIVE_EVENTS: "ACTIVE_EVENTS",
    COURTESIES_PER_EVENT: "COURTESIES_PER_EVENT",
    SCANNERS_PER_EVENT: "SCANNERS_PER_EVENT",
});

const LIMIT_FIELD_BY_KEY = {
    [PlanLimitKey.ACTIVE_EVENTS]: "maxActiveEvents",
    [PlanLimitKey.COURTESIES_PER_EVENT]: "maxCourtesiesPerEvent",
    [PlanLimitKey.SCANNERS_PER_EVENT]: "maxScannersPerEvent",
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

// Conveniencia: resuelve los límites a partir de una Organization ya
// cargada (usa organization.plan, default FREE si no viene).
export async function getOrganizationPlanLimits(organization) {
    return getPlanLimits(organization?.plan ?? "FREE");
}

export function isPremium(organization) {
    return organization?.plan === "PREMIUM";
}

// Todas las features de PremiumFeature exigen Premium hoy. Sin guard
// activo todavía en ningún endpoint real — lo consume una fase posterior.
export function isFeatureAvailable(organization, feature) {
    if (!Object.values(PremiumFeature).includes(feature)) {
        throw new Error(`organizationPlanPolicy: feature desconocida "${feature}"`);
    }
    return isPremium(organization);
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
