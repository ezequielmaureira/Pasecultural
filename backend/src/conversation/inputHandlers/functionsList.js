import { isValidDateString } from "./date.js";
import { isValidTimeString } from "./time.js";
import { normalizeCalendarDateString } from "../../utils/calendarDate.js";

// "Administrador de funciones": lista completa de funciones (usada tanto
// para cargar "varias funciones" a mano como para revisar/editar el
// resultado de "funciones recurrentes" antes de confirmarlo). `date` es una
// fecha de calendario — se normaliza tal cual, nunca como timestamp (ver
// comentario equivalente en functionCard.js).
export function parse(rawValue) {
    if (!Array.isArray(rawValue) || rawValue.length === 0) {
        return { error: "Agregá al menos una función." };
    }

    const functions = [];
    for (const item of rawValue) {
        if (!isValidDateString(item?.date) || !isValidTimeString(item?.startTime) || !isValidTimeString(item?.endTime)) {
            return { error: "Cada función necesita fecha, hora de inicio y hora de fin válidas." };
        }
        functions.push({
            date: normalizeCalendarDateString(item.date),
            startTime: item.startTime,
            endTime: item.endTime,
        });
    }

    return { value: functions };
}
