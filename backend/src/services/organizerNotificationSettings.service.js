import prisma from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { logger } from "../logging/logger.js";
import { getMyOrganizationService } from "./organization.service.js";

// Notificaciones Organizer — Dashboard Organizador > Configuración >
// Notificaciones. Mismo criterio "nunca romper la operación que dispara la
// notificación" que getDeveloperAlertConfigOrDefaults: si no hay fila
// todavía para la organización, o si la lectura falla, se cae a "todo
// apagado" en vez de lanzar. Las obligatorias no están acá: no tienen
// ningún flag que las controle (ver el comentario del modelo en
// schema.prisma).
const DEFAULTS = Object.freeze({
    saleConfirmedEnabled: false,
    salesMilestoneEnabled: false,
    salesMilestoneCount: 100,
    lowStockEnabled: false,
    lowStockPercent: 20,
    eventReminderEnabled: false,
    eventReminderHoursBefore: 24,
    eventStartEnabled: false,
    eventEndEnabled: false,
    scannerActivityEnabled: false,
});

function serialize(row) {
    if (!row) return { ...DEFAULTS };
    return {
        saleConfirmedEnabled: row.saleConfirmedEnabled,
        salesMilestoneEnabled: row.salesMilestoneEnabled,
        salesMilestoneCount: row.salesMilestoneCount,
        lowStockEnabled: row.lowStockEnabled,
        lowStockPercent: row.lowStockPercent,
        eventReminderEnabled: row.eventReminderEnabled,
        eventReminderHoursBefore: row.eventReminderHoursBefore,
        eventStartEnabled: row.eventStartEnabled,
        eventEndEnabled: row.eventEndEnabled,
        scannerActivityEnabled: row.scannerActivityEnabled,
        updatedAt: row.updatedAt,
    };
}

// Validación PURA (nunca toca la base, nunca lanza) — mismo criterio que
// validateDeveloperAlertConfigInput.
export function validateOrganizerNotificationSettingsInput(input) {
    const errors = [];
    const bool = (value, label) => {
        if (typeof value !== "boolean") errors.push(`${label} debe ser true o false.`);
        return Boolean(value);
    };
    const positiveInt = (value, label) => {
        const n = Number(value);
        if (!Number.isInteger(n) || n <= 0) errors.push(`${label} debe ser un número entero mayor a 0.`);
        return n;
    };

    const saleConfirmedEnabled = bool(input?.saleConfirmedEnabled, "Avisarme por cada venta confirmada");
    const salesMilestoneEnabled = bool(input?.salesMilestoneEnabled, "Avisarme cada X entradas vendidas");
    const salesMilestoneCount = positiveInt(input?.salesMilestoneCount, "La cantidad de entradas del hito de ventas");
    const lowStockEnabled = bool(input?.lowStockEnabled, "Avisarme cuando quede X% de stock");
    const lowStockPercent = Number(input?.lowStockPercent);
    if (!Number.isInteger(lowStockPercent) || lowStockPercent <= 0 || lowStockPercent >= 100) {
        errors.push("El porcentaje de stock bajo debe ser un número entero entre 1 y 99.");
    }
    const eventReminderEnabled = bool(input?.eventReminderEnabled, "Recordarme antes del evento");
    const eventReminderHoursBefore = positiveInt(input?.eventReminderHoursBefore, "La anticipación del recordatorio (en horas)");
    const eventStartEnabled = bool(input?.eventStartEnabled, "Avisarme cuando comienza");
    const eventEndEnabled = bool(input?.eventEndEnabled, "Avisarme cuando termina");
    const scannerActivityEnabled = bool(input?.scannerActivityEnabled, "Recibir notificaciones de actividad de Scanner");

    if (errors.length > 0) return { valid: false, errors };

    return {
        valid: true,
        errors: [],
        sanitized: {
            saleConfirmedEnabled,
            salesMilestoneEnabled,
            salesMilestoneCount,
            lowStockEnabled,
            lowStockPercent,
            eventReminderEnabled,
            eventReminderHoursBefore,
            eventStartEnabled,
            eventEndEnabled,
            scannerActivityEnabled,
        },
    };
}

// GET — Dashboard Organizador > Configuración > Notificaciones. Resuelve la
// organización EXCLUSIVAMENTE por ownership (getMyOrganizationService,
// clerkId autenticado) — nunca por un organizationId mandado por el
// cliente, mismo criterio que el resto del panel Organizer.
export async function getOrganizerNotificationSettingsService(clerkId) {
    const organization = await getMyOrganizationService(clerkId);
    if (!organization) throw new AppError(ErrorCodes.ORGANIZER_NOTIFICATION_SETTINGS_NO_ORGANIZATION);

    const row = await prisma.organizerNotificationSettings.findUnique({ where: { organizationId: organization.id } });
    return serialize(row);
}

// PUT — reemplaza las preferencias de forma atómica (upsert: la primera vez
// que una organización guarda, crea la fila; después, siempre actualiza la
// misma). Mismo aislamiento que el GET.
export async function replaceOrganizerNotificationSettingsService(clerkId, input) {
    const organization = await getMyOrganizationService(clerkId);
    if (!organization) throw new AppError(ErrorCodes.ORGANIZER_NOTIFICATION_SETTINGS_NO_ORGANIZATION);

    const { valid, errors, sanitized } = validateOrganizerNotificationSettingsInput(input);
    if (!valid) throw new AppError(ErrorCodes.ORGANIZER_NOTIFICATION_SETTINGS_INVALID, { details: errors });

    const row = await prisma.organizerNotificationSettings.upsert({
        where: { organizationId: organization.id },
        create: { organizationId: organization.id, ...sanitized },
        update: sanitized,
    });

    logger.info("organizer notification settings replaced", { organizationId: organization.id });
    return serialize(row);
}

// Aritmética PURA de "cruce de umbral/hito" (nunca toca la base, nunca
// lanza) — extraída así, en vez de dejarla inline en cada hook, para poder
// testearla sin DB (ver tests/organizerNotifications.pure.test.js) y para
// que sale.service.js/scanner.service.js usen exactamente la misma regla,
// nunca una reimplementada dos veces.

// Hito de ventas — múltiplos de `step` cruzados entre `before` y `after`
// (ambos conteos totales, `after` = `before` + lo que se acaba de sumar).
// Puede devolver más de un múltiplo si una sola venta cruza varios de una
// vez (ej. 80 -> 230 con step=100 cruza 100 Y 200).
export function computeCrossedStepMilestones(before, after, step) {
    if (!(step > 0) || after <= before) return [];
    const crossed = [];
    let milestone = Math.floor(before / step) * step + step;
    while (milestone <= after) {
        crossed.push(milestone);
        milestone += step;
    }
    return crossed;
}

// Stock bajo — cruce descendente de un umbral de cantidad (nunca de
// porcentaje directamente: el caller ya convirtió el % configurado a una
// cantidad de entradas sobre la capacidad real, ver sale.service.js).
export function hasCrossedThresholdDown(before, after, thresholdCount) {
    return before > thresholdCount && after <= thresholdCount;
}

// Agotado — la venta que hace bajar el disponible de "algo" a "cero".
export function hasJustSoldOut(before, after) {
    return before > 0 && after === 0;
}

// ÚNICO punto que el resto del sistema (hooks en sale.service.js,
// scanner.service.js, mercadoPagoConnection.service.js) usa para leer
// preferencias antes de decidir si manda una notificación configurable.
// NUNCA lanza — una notificación jamás puede romper la operación principal
// que la dispara sólo porque esta lectura falló. Las alertas OBLIGATORIAS
// nunca llaman a esto: no dependen de ningún flag.
export async function getOrganizerNotificationSettingsOrDefaults(organizationId) {
    try {
        const row = await prisma.organizerNotificationSettings.findUnique({ where: { organizationId } });
        return serialize(row);
    } catch (err) {
        logger.error(err, { context: "organizer notification settings: no se pudo leer, usando defaults en memoria (todo apagado)", organizationId });
        return { ...DEFAULTS };
    }
}

// Reclamo atómico "una única vez" (ver OrganizerNotificationClaim en
// schema.prisma) — create() gana la carrera; P2002 significa "ya
// reclamado", nunca un error. A diferencia de tryClaimDeveloperAlertCooldown
// no hay ventana de tiempo: un `key` reclamado queda reclamado para
// siempre.
export async function tryClaimOrganizerNotification(key) {
    try {
        await prisma.organizerNotificationClaim.create({ data: { key } });
        return true;
    } catch (err) {
        if (err?.code === "P2002") return false;
        throw err;
    }
}
