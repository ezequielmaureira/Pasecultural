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

const NOTE_MAX_LENGTH = 500;

// Observación personal libre por key ("por qué no pude probar esto
// todavía", etc.) — NUNCA afecta checked/stats (ver computeStats más
// abajo, que no la mira). Validación PURA: string (o null para
// limpiarla), recortada, máximo 500 caracteres. Vacío/sólo-espacios se
// normaliza a null — mismo criterio que checkedAt/checkedByUserId
// (ausencia de valor = null, nunca "").
function validateNote(note) {
    if (note === undefined) return { provided: false };
    if (note === null) return { provided: true, value: null };
    if (typeof note !== "string") {
        throw new AppError(ErrorCodes.QA_CHECKLIST_INVALID_INPUT);
    }
    const trimmed = note.trim();
    if (trimmed.length > NOTE_MAX_LENGTH) {
        throw new AppError(ErrorCodes.QA_CHECKLIST_NOTE_TOO_LONG);
    }
    return { provided: true, value: trimmed === "" ? null : trimmed };
}

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
            note: state?.note ?? "",
        };
    });

    return { items, stats: computeStats(items) };
}

// PATCH /api/developer/qa-checklist/:key — actualización PARCIAL: body
// puede traer `checked`, `note`, o ambos (al menos uno). `checked` tilda o
// destilda UNA funcionalidad — nunca inferido, siempre explícito
// true/false. Destildar limpia checkedAt/checkedByUserId a propósito: esto
// es un checkbox, no un historial de auditoría — "no verificada" no
// necesita recordar quién la destildó ni cuándo. `note` es independiente:
// cambiar `checked` nunca toca `note`, y viceversa — sólo se escribe el
// campo que efectivamente vino en el body (ver checkedFields/noteFields
// más abajo, nunca se arma un `data` con las tres claves si sólo una vino).
export async function updateQaChecklistItemService(key, input, developerUserId) {
    if (!isValidQaChecklistKey(key)) {
        throw new AppError(ErrorCodes.QA_CHECKLIST_UNKNOWN_KEY);
    }

    const { checked } = input ?? {};
    const hasChecked = checked !== undefined;
    if (hasChecked && typeof checked !== "boolean") {
        throw new AppError(ErrorCodes.QA_CHECKLIST_INVALID_INPUT);
    }

    const noteResult = validateNote(input?.note);
    if (!hasChecked && !noteResult.provided) {
        throw new AppError(ErrorCodes.QA_CHECKLIST_INVALID_INPUT);
    }

    const checkedFields = hasChecked
        ? checked
            ? { checked: true, checkedAt: new Date(), checkedByUserId: developerUserId }
            : { checked: false, checkedAt: null, checkedByUserId: null }
        : {};
    const noteFields = noteResult.provided ? { note: noteResult.value } : {};
    const data = { ...checkedFields, ...noteFields };

    const state = await prisma.qaChecklistState.upsert({
        where: { key },
        update: data,
        create: {
            key,
            checked: hasChecked ? checked : false,
            checkedAt: checkedFields.checkedAt ?? null,
            checkedByUserId: checkedFields.checkedByUserId ?? null,
            note: noteResult.provided ? noteResult.value : null,
        },
    });

    logger.info("qa checklist item updated", { key, checked: hasChecked ? checked : undefined, noteChanged: noteResult.provided, developerUserId });

    return {
        ...getQaChecklistItem(key),
        checked: state.checked,
        checkedAt: state.checkedAt,
        checkedByUserId: state.checkedByUserId,
        note: state.note ?? "",
    };
}
