import { isValidDateString } from "./date.js";
import { isValidTimeString } from "./time.js";

// Una función completa en un solo intercambio: fecha + hora de inicio + hora
// de fin. `rawValue` viene armado por FunctionCardAnswer.jsx (frontend).
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

    return { value: { date: new Date(date).toISOString(), startTime, endTime } };
}
