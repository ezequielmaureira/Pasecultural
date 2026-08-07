import { isValidDateString } from "./date.js";
import { isValidTimeString } from "./time.js";
import { normalizeCalendarDateString } from "../../utils/calendarDate.js";

// Una función completa en un solo intercambio: fecha + hora de inicio + hora
// de fin. `rawValue` viene armado por FunctionCardAnswer.jsx (frontend).
// `date` es una fecha de calendario (no un instante) — se guarda normalizada
// tal cual, nunca como timestamp: la combinación real con la hora ocurre
// recién en EventServicePort.js#combineCalendarDateTime, en la timezone
// oficial de la plataforma.
export function parse(rawValue) {
    const date = rawValue?.date;
    const startTime = rawValue?.startTime;
    const endTime = rawValue?.endTime;

    if (!isValidDateString(date)) {
        return { error: "Necesito una fecha válida para la función." };
    }
    if (!isValidTimeString(startTime) || !isValidTimeString(endTime)) {
        return { error: "Necesito hora de inicio y de fin en formato HH:mm." };
    }

    return { value: { date: normalizeCalendarDateString(date), startTime, endTime } };
}
