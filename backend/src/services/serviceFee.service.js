import crypto from "node:crypto";
import prisma from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { logger } from "../logging/logger.js";
import { round2 } from "../utils/money.js";

// MP-6 — ÚNICA fuente de verdad server-side de la comisión de servicio de
// PaseCultural para Mercado Pago. Reemplaza por completo a
// config/platformFee.js (PLATFORM_FEE_PERCENTAGE, eliminado): la comisión
// ya NO es un porcentaje descontado del precio del organizador, es un
// importe FIJO por entrada, sumado por encima del precio, según en qué
// rango cae el precio UNITARIO de esa entrada — ver
// calculateServiceFeeForUnitPrice.
//
// Ningún otro archivo del backend calcula ni valida esto por su cuenta —
// createSaleForBuyer (sale.service.js) y developerServiceFee.service.js
// son los únicos callers.

// El precio $0 NUNCA consulta la tabla de rangos — hardcodeado acá,
// deliberadamente, para que ninguna configuración guardada desde
// Developer pueda, por error u omisión, convertir una entrada gratuita en
// una venta paga. round2 primero: un precio que redondea a exactamente
// 0.00 (nunca debería poder pasar con los precios ya redondeados de
// TicketType/FunctionTicketType, pero se trata igual como gratuito, nunca
// como "fuera de rango").
export function calculateServiceFeeForUnitPrice(unitPrice, tiers) {
    const price = round2(Number(unitPrice));
    if (!(price > 0)) return 0;

    const tier = tiers.find((t) => {
        const min = round2(Number(t.minAmount));
        const max = t.maxAmount == null ? null : round2(Number(t.maxAmount));
        return price >= min && (max === null || price < max);
    });

    // null explícito (nunca 0 disfrazado de "no encontré nada"): un precio
    // positivo que no cae en ningún rango configurado es una configuración
    // incompleta, no una entrada gratuita — el caller decide qué hacer
    // (ver getValidatedServiceFeeTiersOrThrow, que nunca deja pasar esto).
    if (!tier) return null;
    return round2(Number(tier.feeAmount));
}

// Validación PURA (nunca toca la base, nunca lanza) — usada tanto para
// revalidar lo que ya está guardado antes de confiar en ello en un
// checkout (defensa en profundidad, por si alguna vez hay una fila
// guardada por fuera de replaceServiceFeeTiers) como para validar lo que
// Developer > Configuración intenta guardar ANTES de persistirlo.
// Devuelve { valid, errors, sortedTiers } — sortedTiers viene siempre
// redondeado a 2 decimales y ordenado por minAmount, listo para persistir
// tal cual si valid=true.
export function validateServiceFeeTiersInput(tiersInput) {
    const errors = [];

    if (!Array.isArray(tiersInput) || tiersInput.length === 0) {
        return { valid: false, errors: ["Debe haber al menos un rango de comisión configurado."] };
    }

    const parsed = tiersInput.map((raw, index) => {
        const minAmount = round2(Number(raw?.minAmount));
        const hasMax = raw?.maxAmount !== null && raw?.maxAmount !== undefined && raw?.maxAmount !== "";
        const maxAmount = hasMax ? round2(Number(raw.maxAmount)) : null;
        const feeAmount = round2(Number(raw?.feeAmount));
        const label = `Rango ${index + 1}`;

        if (!Number.isFinite(minAmount) || minAmount < 0) {
            errors.push(`${label}: el límite inferior debe ser un número mayor o igual a $0.`);
        }
        if (hasMax && (!Number.isFinite(maxAmount) || maxAmount < 0)) {
            errors.push(`${label}: el límite superior debe ser un número mayor o igual a $0.`);
        }
        if (!Number.isFinite(feeAmount) || feeAmount < 0) {
            errors.push(`${label}: el importe de comisión debe ser un número mayor o igual a $0.`);
        }
        if (hasMax && Number.isFinite(minAmount) && Number.isFinite(maxAmount) && minAmount >= maxAmount) {
            errors.push(`${label}: el límite inferior debe ser menor que el límite superior.`);
        }

        return { minAmount, maxAmount, feeAmount };
    });

    // Si algún rango individual ya es inválido (montos no numéricos,
    // negativos, invertidos), no tiene sentido evaluar contigüidad sobre
    // datos que no se pueden ordenar/comparar con confianza.
    if (errors.length > 0) return { valid: false, errors };

    const sorted = [...parsed].sort((a, b) => a.minAmount - b.minAmount);

    const openTiers = sorted.filter((t) => t.maxAmount === null);
    if (openTiers.length === 0) {
        errors.push("Debe haber exactamente un rango final sin límite superior, para cubrir cualquier precio mayor al último límite.");
    } else if (openTiers.length > 1) {
        errors.push("No puede haber más de un rango sin límite superior.");
    } else if (sorted[sorted.length - 1].maxAmount !== null) {
        errors.push("El rango sin límite superior debe ser el de mayor precio (el último al ordenar).");
    }

    if (sorted[0].minAmount !== 0) {
        errors.push("El primer rango (el de menor precio) debe empezar en $0.");
    }

    for (let i = 0; i < sorted.length - 1; i++) {
        const current = sorted[i];
        const next = sorted[i + 1];
        if (current.maxAmount === null) continue; // ya reportado arriba si no debía serlo
        if (current.maxAmount < next.minAmount) {
            errors.push(`Hay un hueco entre $${current.maxAmount} y $${next.minAmount}: ningún rango cubre esos precios.`);
        } else if (current.maxAmount > next.minAmount) {
            errors.push(`Hay superposición entre el rango que termina en $${current.maxAmount} y el que empieza en $${next.minAmount}.`);
        }
    }

    return { valid: errors.length === 0, errors, sortedTiers: sorted };
}

// Lectura simple, sin caché — MP-6 evaluó explícitamente agregar caché
// (auditoría, sección "Concurrencia y caché") y decidió NO hacerlo: el
// volumen actual de PaseCultural no lo justifica, y un caché mal invalidado
// entre múltiples instancias de Render es exactamente el tipo de bug
// "comisión vieja activa indefinidamente" que se pidió evitar. Guardar
// desde Developer ya es atómico (replaceServiceFeeTiers) — el próximo
// checkout que lea acá ve siempre el conjunto completo, nunca uno parcial.
export async function getActiveServiceFeeTiers() {
    return prisma.serviceFeeTier.findMany({ orderBy: { minAmount: "asc" } });
}

// Único punto que el checkout usa para obtener rangos en los que confiar.
// Revalida lo leído (defensa en profundidad — nunca asume que lo que ya
// está en la base pasó, en su momento, la validación de escritura) y
// falla fuerte y explícito si no hay una configuración utilizable, en vez
// de dejar pasar un checkout con comisión $0 por accidente (requisito
// explícito de la auditoría).
export async function getValidatedServiceFeeTiersOrThrow() {
    const tiers = await getActiveServiceFeeTiers();
    const { valid, errors } = validateServiceFeeTiersInput(tiers);
    if (!valid) {
        logger.error(new Error("service fee: no hay una configuración de comisión válida para procesar un checkout"), {
            tierCount: tiers.length,
            errors,
        });
        throw new AppError(ErrorCodes.SERVICE_FEE_CONFIG_MISSING);
    }
    return tiers;
}

// Reemplazo atómico del conjunto completo — delete-all + create dentro de
// UNA transacción: bajo el nivel de aislamiento por default de Postgres
// (READ COMMITTED), ningún checkout concurrente puede llegar a leer un
// conjunto a medio borrar — o ve el conjunto viejo completo (si esta
// transacción todavía no commiteó) o el nuevo completo (si ya commiteó),
// nunca algo intermedio. Nunca preserva los `id` de los rangos anteriores
// a propósito — ver el comentario del modelo en schema.prisma: nada más
// los referencia por id, Sale/SaleItem sólo guardan el importe ya
// calculado.
export async function replaceServiceFeeTiers(tiersInput, updatedByUserId) {
    const { valid, errors, sortedTiers } = validateServiceFeeTiersInput(tiersInput);
    if (!valid) {
        throw new AppError(ErrorCodes.SERVICE_FEE_TIERS_INVALID, { details: errors });
    }

    await prisma.$transaction(async (tx) => {
        await tx.serviceFeeTier.deleteMany({});
        await tx.serviceFeeTier.createMany({
            data: sortedTiers.map((tier) => ({
                minAmount: tier.minAmount,
                maxAmount: tier.maxAmount,
                feeAmount: tier.feeAmount,
                updatedByUserId,
            })),
        });
    });

    logger.info("service fee tiers replaced", { updatedByUserId, tierCount: sortedTiers.length });
}

// Ronda de endurecimiento — hash de contenido, no un contador ni un
// timestamp: identifica de forma estable un conjunto de rangos por su
// VALOR (dos guardados que terminan con exactamente los mismos rangos dan
// el mismo hash, aunque hayan sido filas distintas en la base — coherente
// con que Sale/SaleItem tampoco referencian ninguna fila de acá por id,
// ver el comentario del modelo en schema.prisma). Expuesto en el endpoint
// público (getPublicServiceFeeTiers) para diagnóstico/uso futuro — la
// protección optimista real del checkout (ver createSaleForBuyer) compara
// el desglose calculado (ticketsSubtotal/serviceFee/total), no este hash,
// porque un cambio de configuración que no afecta a ESTA compra puntual
// (ej. se tocó sólo el rango de $1.000.000+) no debería bloquearla.
// `tiers` se recibe YA ordenado por minAmount (getActiveServiceFeeTiers).
export function computeServiceFeeTiersVersion(tiers) {
    const canonical = tiers
        .map((t) => {
            const min = round2(Number(t.minAmount));
            const max = t.maxAmount == null ? "open" : round2(Number(t.maxAmount));
            const fee = round2(Number(t.feeAmount));
            return `${min}:${max}:${fee}`;
        })
        .join("|");
    return crypto.createHash("sha256").update(canonical).digest("hex");
}
