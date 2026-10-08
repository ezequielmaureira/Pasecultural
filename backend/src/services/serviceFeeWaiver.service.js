import prisma from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { logger } from "../logging/logger.js";

// Beneficio para compradores — cargo de servicio Smarticket $0.
//
// Regla comercial: cada organización recibe N meses calendario sin cargo
// de servicio para sus compradores, contados desde que publica su PRIMER
// evento. N sale de Developer > Configuración
// (service_fee_settings.serviceFeeWaiverDurationMonths, 0 = desactivado),
// la misma pantalla que define los rangos de cargo (service_fee_tiers).
// Al vencer vuelven solos los cargos fijos de service_fee_tiers. Developer
// puede renovarlo a mano (de a N meses, con el N vigente al renovar; nunca
// automático). La comisión al organizador es SIEMPRE $0 — este archivo
// sólo decide el cargo del COMPRADOR.
//
// Dos columnas en Organization:
// - firstEventPublishedAt: dato histórico, se escribe una única vez
//   (recordFirstEventPublication) y nada lo vuelve a tocar — ni publicar
//   otro evento, ni despublicar/republicar, ni borrar eventos, ni renovar.
//   Se guarda aunque la duración configurada sea 0.
// - serviceFeeWaivedUntil: hasta cuándo (exclusivo) los compradores pagan
//   $0. Nace como firstEventPublishedAt + N meses con el N de ESE momento
//   (snapshot: cambiar la configuración después nunca lo recalcula), null
//   si N era 0. Sólo lo extiende renewServiceFeeWaiverService.
//
// La decisión de cobrar o no la toma SIEMPRE el backend
// (isServiceFeeWaived en createSaleForBuyer); el frontend sólo la refleja.

// Tope de la configuración: evita un valor absurdo (ej. 1000 meses por un
// cero de más) que regalaría el cargo de servicio para siempre.
export const MAX_SERVICE_FEE_WAIVER_DURATION_MONTHS = 12;

// Argentina no tiene horario de verano desde 2009: UTC-3 fijo. Los meses
// se suman sobre la fecha LOCAL (10/12 → 10/01, aunque en UTC ya sea el 11).
const ARGENTINA_OFFSET_MS = -3 * 60 * 60 * 1000;

// + N meses calendario (no 30 días por mes), conservando la hora. Si el
// día no existe en el mes de destino se usa el último día de ese mes:
// 31/01 + 1 → 28/02 (o 29/02), 31/03 + 1 → 30/04, 31/12 + 2 → 28/02.
export function addCalendarMonths(date, months) {
    if (!Number.isInteger(months) || months < 0) {
        throw new RangeError(`addCalendarMonths: cantidad de meses inválida (${months})`);
    }
    const local = new Date(new Date(date).getTime() + ARGENTINA_OFFSET_MS);
    const day = local.getUTCDate();
    const target = new Date(local.getTime());
    target.setUTCDate(1);
    target.setUTCMonth(target.getUTCMonth() + months);
    const lastDayOfTargetMonth = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(day, lastDayOfTargetMonth));
    return new Date(target.getTime() - ARGENTINA_OFFSET_MS);
}

export function isValidServiceFeeWaiverDurationMonths(value) {
    return Number.isInteger(value) && value >= 0 && value <= MAX_SERVICE_FEE_WAIVER_DURATION_MONTHS;
}

// Duración vigente configurada en Developer > Configuración. `client`
// permite leerla dentro de la transacción del caller. Sin fila (sólo si
// alguien la borró a mano: la migración la siembra) o con un valor fuera
// de rango → 0: nunca se regala un beneficio que nadie configuró, y queda
// registrado en logs.
export async function getServiceFeeWaiverDurationMonths(client = prisma) {
    const row = await client.serviceFeeSettings.findFirst({ orderBy: { createdAt: "asc" } });
    if (!row) {
        logger.error(new Error("service fee settings: no hay fila configurada, tratando la duración del beneficio como 0"), {});
        return 0;
    }
    if (!isValidServiceFeeWaiverDurationMonths(row.serviceFeeWaiverDurationMonths)) {
        logger.error(new Error("service fee settings: duración del beneficio fuera de rango, tratando como 0"), {
            value: row.serviceFeeWaiverDurationMonths,
        });
        return 0;
    }
    return row.serviceFeeWaiverDurationMonths;
}

// Vencimiento inicial para una primera publicación con la duración dada:
// null si la duración es 0 (promoción inicial desactivada).
export function initialServiceFeeWaivedUntil(firstEventPublishedAt, durationMonths) {
    return durationMonths > 0 ? addCalendarMonths(firstEventPublishedAt, durationMonths) : null;
}

// Vigente mientras now < serviceFeeWaivedUntil (exactamente en el
// vencimiento ya se cobra el tier normal).
export function isServiceFeeWaived(organization, now = new Date()) {
    const until = organization?.serviceFeeWaivedUntil;
    return Boolean(until) && now.getTime() < new Date(until).getTime();
}

// "NOT_STARTED" (nunca publicó) | "ACTIVE" | "EXPIRED" | "NONE" (publicó
// con la promoción inicial desactivada — duración 0 — y nunca se le
// otorgó una renovación).
export function getServiceFeeWaiverStatus(organization, now = new Date()) {
    if (!organization?.serviceFeeWaivedUntil) {
        return organization?.firstEventPublishedAt ? "NONE" : "NOT_STARTED";
    }
    return isServiceFeeWaived(organization, now) ? "ACTIVE" : "EXPIRED";
}

// Evidencia de la primera publicación de una organización, a partir de sus
// eventos. Usado por recordFirstEventPublication y por el backfill
// (scripts/backfillServiceFeeWaiver.js), así los dos aplican la misma
// regla:
// 1. MIN(Event.publishedAt);
// 2. si no hay ninguno, eventos PUBLISHED viejos sin publishedAt (de antes
//    de que existiera la columna): createdAt del más antiguo;
// 3. si no hay evidencia, null.
export async function findFirstPublicationEvidence(client, organizationId) {
    const { _min } = await client.event.aggregate({
        where: { organizationId, publishedAt: { not: null } },
        _min: { publishedAt: true },
    });
    if (_min.publishedAt) return { date: _min.publishedAt, source: "publishedAt" };

    const legacy = await client.event.findFirst({
        where: { organizationId, status: "PUBLISHED", publishedAt: null },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
    });
    if (legacy) return { date: legacy.createdAt, source: "createdAt" };

    return null;
}

// Llamado DENTRO de la transacción que publica un evento
// (updateMyEventService). Si la organización ya tiene
// firstEventPublishedAt no hace nada. Si no, lo fija una sola vez con
// `updateMany where firstEventPublishedAt = null`: con dos publicaciones
// simultáneas, Postgres bloquea la fila y la segunda reevalúa el WHERE
// después del commit de la primera → 0 filas, nunca pisa la fecha.
//
// La fecha sale de findFirstPublicationEvidence (que ya ve el publishedAt
// recién escrito en esta misma transacción): para una organización nueva
// es "ahora"; para una vieja que todavía no pasó por el backfill es su
// publicación real más antigua, así nunca recibe un beneficio nuevo de
// regalo. La duración es la configurada en este momento (snapshot).
export async function recordFirstEventPublication(tx, organizationId) {
    const organization = await tx.organization.findUnique({
        where: { id: organizationId },
        select: { firstEventPublishedAt: true },
    });
    if (!organization || organization.firstEventPublishedAt) return;

    const evidence = await findFirstPublicationEvidence(tx, organizationId);
    if (!evidence) return;

    const durationMonths = await getServiceFeeWaiverDurationMonths(tx);
    const serviceFeeWaivedUntil = initialServiceFeeWaivedUntil(evidence.date, durationMonths);

    const { count } = await tx.organization.updateMany({
        where: { id: organizationId, firstEventPublishedAt: null },
        data: { firstEventPublishedAt: evidence.date, serviceFeeWaivedUntil },
    });
    if (count > 0) {
        logger.info("service fee waiver: primera publicación registrada", {
            organizationId,
            firstEventPublishedAt: evidence.date,
            source: evidence.source,
            durationMonths,
            serviceFeeWaivedUntil,
        });
    }
}

// Developer → "Extender beneficio N meses" / "Renovar beneficio por N
// meses", con el N configurado al momento de renovar. ACTIVO: vencimiento
// actual + N. VENCIDO (o publicó con la promoción desactivada): ahora + N.
// Nunca toca firstEventPublishedAt. No se puede renovar una organización
// que nunca publicó (el beneficio todavía no empezó) ni con la duración
// configurada en 0 (promoción desactivada desde Configuración).
//
// Optimista: el update exige que serviceFeeWaivedUntil siga siendo el que
// se leyó, así un doble click (o dos developers a la vez) nunca suma un
// período de más — el segundo recibe SERVICE_FEE_WAIVER_CONFLICT y recarga.
export async function renewServiceFeeWaiverService(organizationId, developerUserId, now = new Date()) {
    const organization = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { id: true, closedAt: true, firstEventPublishedAt: true, serviceFeeWaivedUntil: true },
    });
    if (!organization || organization.closedAt) return null;

    const status = getServiceFeeWaiverStatus(organization, now);
    if (status === "NOT_STARTED") {
        throw new AppError(ErrorCodes.SERVICE_FEE_WAIVER_NOT_STARTED);
    }

    const durationMonths = await getServiceFeeWaiverDurationMonths();
    if (durationMonths === 0) {
        throw new AppError(ErrorCodes.SERVICE_FEE_WAIVER_DISABLED);
    }

    const base = status === "ACTIVE" ? organization.serviceFeeWaivedUntil : now;
    const nextUntil = addCalendarMonths(base, durationMonths);

    const { count } = await prisma.organization.updateMany({
        where: { id: organizationId, serviceFeeWaivedUntil: organization.serviceFeeWaivedUntil },
        data: { serviceFeeWaivedUntil: nextUntil },
    });
    if (count === 0) {
        throw new AppError(ErrorCodes.SERVICE_FEE_WAIVER_CONFLICT);
    }

    logger.info("service fee waiver: renovado desde Developer", {
        organizationId,
        developerUserId,
        previousStatus: status,
        previousUntil: organization.serviceFeeWaivedUntil,
        durationMonths,
        nextUntil,
    });

    return prisma.organization.findUnique({ where: { id: organizationId } });
}

// Developer > Configuración — lectura de la fila (lanza si falta, como
// getPublicLaunchSettingsService: el panel tiene que enterarse).
export async function getServiceFeeSettingsService() {
    const row = await prisma.serviceFeeSettings.findFirst({ orderBy: { createdAt: "asc" } });
    if (!row) throw new AppError(ErrorCodes.SERVICE_FEE_SETTINGS_MISSING);
    return { serviceFeeWaiverDurationMonths: row.serviceFeeWaiverDurationMonths, updatedAt: row.updatedAt };
}

// Developer > Configuración — guardar la duración. Sólo afecta primeras
// publicaciones y renovaciones POSTERIORES: nunca toca ningún
// serviceFeeWaivedUntil ya calculado.
export async function setServiceFeeWaiverDurationService(userId, value) {
    if (!userId) throw new AppError(ErrorCodes.USER_NOT_FOUND);
    if (!isValidServiceFeeWaiverDurationMonths(value)) {
        throw new AppError(ErrorCodes.SERVICE_FEE_SETTINGS_INVALID);
    }

    const existing = await prisma.serviceFeeSettings.findFirst({ orderBy: { createdAt: "asc" } });
    const data = { serviceFeeWaiverDurationMonths: value, updatedByUserId: userId };
    const row = existing
        ? await prisma.serviceFeeSettings.update({ where: { id: existing.id }, data })
        : await prisma.serviceFeeSettings.create({ data });

    logger.info("service fee settings changed", { updatedByUserId: userId, serviceFeeWaiverDurationMonths: value });
    return { serviceFeeWaiverDurationMonths: row.serviceFeeWaiverDurationMonths, updatedAt: row.updatedAt };
}
