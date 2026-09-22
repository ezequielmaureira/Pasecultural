import prisma from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { logger } from "../logging/logger.js";
import { QA_CHECKLIST_CATALOG, getQaChecklistItem, isValidQaChecklistKey } from "../qa/qaChecklistCatalog.js";

// Developer > QA / Checklist. La definición de cada funcionalidad
// (key/role/entity/label/order) vive en código (ver qaChecklistCatalog.js)
// — este service sólo lee/escribe el ESTADO (QaChecklistState), y lo
// combina con el catálogo en memoria. Nunca hay que sembrar la tabla: una
// key del catálogo sin fila en la base se interpreta como no verificada.

function withPercent(bucket) {
    return {
        checked: bucket.checked,
        total: bucket.total,
        percent: bucket.total > 0 ? Math.round((bucket.checked / bucket.total) * 100) : 0,
    };
}

// Fórmula única y sin pesos: tildadas / totales, en 3 niveles (global, por
// rol, por rol > entidad). Nunca inventa un score distinto para cada
// nivel — es la misma cuenta, agregada a distinta granularidad.
function computeStats(items) {
    const global = { checked: 0, total: items.length };
    const byRole = {};

    for (const item of items) {
        const role = (byRole[item.role] ??= { checked: 0, total: 0, entities: {} });
        role.total += 1;
        const entity = (role.entities[item.entity] ??= { checked: 0, total: 0 });
        entity.total += 1;
        if (item.checked) {
            global.checked += 1;
            role.checked += 1;
            entity.checked += 1;
        }
    }

    return {
        global: withPercent(global),
        byRole: Object.fromEntries(
            Object.entries(byRole).map(([role, bucket]) => [
                role,
                {
                    ...withPercent(bucket),
                    entities: Object.fromEntries(
                        Object.entries(bucket.entities).map(([entity, entityBucket]) => [entity, withPercent(entityBucket)])
                    ),
                },
            ])
        ),
    };
}

// GET /api/developer/qa-checklist — catálogo completo + estado persistido
// + estadísticas ya calculadas (global/por rol/por entidad). Sólo
// DEVELOPER (ver developerQaChecklist.routes.js).
export async function getQaChecklistOverviewService() {
    const states = await prisma.qaChecklistState.findMany();
    const stateByKey = new Map(states.map((state) => [state.key, state]));

    const items = QA_CHECKLIST_CATALOG.map((catalogItem) => {
        const state = stateByKey.get(catalogItem.key);
        return {
            ...catalogItem,
            checked: state?.checked ?? false,
            checkedAt: state?.checkedAt ?? null,
            checkedByUserId: state?.checkedByUserId ?? null,
        };
    });

    return { items, stats: computeStats(items) };
}

// PATCH /api/developer/qa-checklist/:key — tilda o destilda UNA
// funcionalidad. `checked` debe venir explícito (true/false), nunca
// inferido. Destildar limpia checkedAt/checkedByUserId a propósito: esto
// es un checkbox, no un historial de auditoría — "no verificada" no
// necesita recordar quién la destildó ni cuándo.
export async function updateQaChecklistItemService(key, checked, developerUserId) {
    if (!isValidQaChecklistKey(key)) {
        throw new AppError(ErrorCodes.QA_CHECKLIST_UNKNOWN_KEY);
    }
    if (typeof checked !== "boolean") {
        throw new AppError(ErrorCodes.QA_CHECKLIST_INVALID_INPUT);
    }

    const data = checked
        ? { checked: true, checkedAt: new Date(), checkedByUserId: developerUserId }
        : { checked: false, checkedAt: null, checkedByUserId: null };

    const state = await prisma.qaChecklistState.upsert({
        where: { key },
        update: data,
        create: { key, ...data },
    });

    logger.info("qa checklist item updated", { key, checked, developerUserId });

    return {
        ...getQaChecklistItem(key),
        checked: state.checked,
        checkedAt: state.checkedAt,
        checkedByUserId: state.checkedByUserId,
    };
}
