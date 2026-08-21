import prisma from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { logger } from "../logging/logger.js";

// Alertas Developer — configuración de umbrales, ÚNICA fuente de verdad
// server-side (reemplaza cualquier número mágico disperso por services,
// mismo criterio que serviceFee.service.js para ServiceFeeTier). Fila
// única ("singleton"): siempre se lee/reemplaza la primera fila por
// createdAt — nunca hay que resolver "cuál" fila, porque sólo puede haber
// una en uso real (replaceDeveloperAlertConfig la reemplaza atómicamente).
//
// Estos valores NUNCA gobiernan el negocio — sólo deciden cuándo una
// alerta informativa se dispara (ver sendDeveloperAlert.service.js). Si
// esta configuración fallara en leerse (DB caída, fila borrada a mano),
// DEFAULTS acá abajo garantiza que ninguna alerta rompa la operación
// principal que la dispara — ver getDeveloperAlertConfigOrDefaults.
const DEFAULTS = Object.freeze({
    highTicketPriceThreshold: 500000,
    highSaleQuantityThreshold: 50,
    eventsWindowCount: 10,
    eventsWindowHours: 24,
    salesVolumeWindowCount: 100,
    salesVolumeWindowMinutes: 60,
    refundsVolumeWindowCount: 10,
    refundsVolumeWindowHours: 24,
    withdrawalRequestsWindowCount: 5,
    withdrawalRequestsWindowHours: 24,
    alertCooldownMinutes: 60,
});

function serializeConfig(row) {
    return {
        id: row.id,
        highTicketPriceThreshold: Number(row.highTicketPriceThreshold),
        highSaleQuantityThreshold: row.highSaleQuantityThreshold,
        eventsWindowCount: row.eventsWindowCount,
        eventsWindowHours: row.eventsWindowHours,
        salesVolumeWindowCount: row.salesVolumeWindowCount,
        salesVolumeWindowMinutes: row.salesVolumeWindowMinutes,
        refundsVolumeWindowCount: row.refundsVolumeWindowCount,
        refundsVolumeWindowHours: row.refundsVolumeWindowHours,
        withdrawalRequestsWindowCount: row.withdrawalRequestsWindowCount,
        withdrawalRequestsWindowHours: row.withdrawalRequestsWindowHours,
        alertCooldownMinutes: row.alertCooldownMinutes,
        updatedAt: row.updatedAt,
    };
}

// Validación PURA (nunca toca la base, nunca lanza) — mismo criterio que
// validateServiceFeeTiersInput. Todo umbral/ventana es un entero positivo;
// highTicketPriceThreshold es el único monto (Decimal, puede tener
// centavos). alertCooldownMinutes puede ser 0 (sin cooldown) pero nunca
// negativo.
export function validateDeveloperAlertConfigInput(input) {
    const errors = [];
    const positiveInt = (value, label) => {
        const n = Number(value);
        if (!Number.isInteger(n) || n <= 0) errors.push(`${label} debe ser un número entero mayor a 0.`);
        return n;
    };

    const highTicketPriceThreshold = Number(input?.highTicketPriceThreshold);
    if (!Number.isFinite(highTicketPriceThreshold) || highTicketPriceThreshold <= 0) {
        errors.push("El precio de entrada que dispara la alerta debe ser un número mayor a $0.");
    }

    const highSaleQuantityThreshold = positiveInt(input?.highSaleQuantityThreshold, "La cantidad de entradas por compra");
    const eventsWindowCount = positiveInt(input?.eventsWindowCount, "La cantidad de eventos");
    const eventsWindowHours = positiveInt(input?.eventsWindowHours, "La ventana de horas para eventos");
    const salesVolumeWindowCount = positiveInt(input?.salesVolumeWindowCount, "La cantidad de ventas");
    const salesVolumeWindowMinutes = positiveInt(input?.salesVolumeWindowMinutes, "La ventana de minutos para ventas");
    const refundsVolumeWindowCount = positiveInt(input?.refundsVolumeWindowCount, "La cantidad de refunds");
    const refundsVolumeWindowHours = positiveInt(input?.refundsVolumeWindowHours, "La ventana de horas para refunds");
    const withdrawalRequestsWindowCount = positiveInt(input?.withdrawalRequestsWindowCount, "La cantidad de solicitudes de arrepentimiento");
    const withdrawalRequestsWindowHours = positiveInt(input?.withdrawalRequestsWindowHours, "La ventana de horas para solicitudes de arrepentimiento");

    const alertCooldownMinutes = Number(input?.alertCooldownMinutes);
    if (!Number.isInteger(alertCooldownMinutes) || alertCooldownMinutes < 0) {
        errors.push("El cooldown entre alertas debe ser un número entero mayor o igual a 0.");
    }

    if (errors.length > 0) return { valid: false, errors };

    return {
        valid: true,
        errors: [],
        sanitized: {
            highTicketPriceThreshold: Math.round(highTicketPriceThreshold * 100) / 100,
            highSaleQuantityThreshold,
            eventsWindowCount,
            eventsWindowHours,
            salesVolumeWindowCount,
            salesVolumeWindowMinutes,
            refundsVolumeWindowCount,
            refundsVolumeWindowHours,
            withdrawalRequestsWindowCount,
            withdrawalRequestsWindowHours,
            alertCooldownMinutes,
        },
    };
}

export async function getDeveloperAlertConfigService() {
    const row = await prisma.developerAlertConfig.findFirst({ orderBy: { createdAt: "asc" } });
    if (!row) throw new AppError(ErrorCodes.DEVELOPER_ALERT_CONFIG_MISSING);
    return serializeConfig(row);
}

// userId ya resuelto por el controller (req.dbUser.id, ver requireRole) —
// mismo criterio que updateServiceFeeConfigService.
export async function replaceDeveloperAlertConfigService(userId, input) {
    if (!userId) throw new AppError(ErrorCodes.USER_NOT_FOUND);
    const { valid, errors, sanitized } = validateDeveloperAlertConfigInput(input);
    if (!valid) throw new AppError(ErrorCodes.DEVELOPER_ALERT_CONFIG_INVALID, { details: errors });

    const existing = await prisma.developerAlertConfig.findFirst({ orderBy: { createdAt: "asc" } });
    const row = existing
        ? await prisma.developerAlertConfig.update({ where: { id: existing.id }, data: { ...sanitized, updatedByUserId: userId } })
        : await prisma.developerAlertConfig.create({ data: { ...sanitized, updatedByUserId: userId } });

    logger.info("developer alert config replaced", { updatedByUserId: userId, configId: row.id });
    return serializeConfig(row);
}

// ÚNICO punto que el resto del sistema (services de negocio, nunca el
// panel Developer) usa para leer umbrales antes de decidir si dispara una
// alerta de patrón/volumen. NUNCA lanza — a diferencia de
// getDeveloperAlertConfigService (que sí, para el panel): una alerta
// informativa jamás puede romper la operación principal que la dispara
// (creación de evento, confirmación de venta, etc.) sólo porque la
// configuración de umbrales no se pudo leer. Si falla, cae a DEFAULTS y lo
// deja registrado para que sea visible en logs, nunca en silencio total.
export async function getDeveloperAlertConfigOrDefaults() {
    try {
        const row = await prisma.developerAlertConfig.findFirst({ orderBy: { createdAt: "asc" } });
        if (!row) {
            logger.warn("developer alert config: no hay ninguna fila configurada, usando defaults en memoria", {});
            return { ...DEFAULTS };
        }
        return serializeConfig(row);
    } catch (err) {
        logger.error(err, { context: "developer alert config: no se pudo leer la configuración, usando defaults en memoria" });
        return { ...DEFAULTS };
    }
}
