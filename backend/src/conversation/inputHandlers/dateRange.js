import { isValidDateString } from "./date.js";
import { normalizeCalendarDateString, compareCalendarDateStrings } from "../../utils/calendarDate.js";

export function parse(rawValue) {
    const from = rawValue?.from;
    const to = rawValue?.to;

    if (!isValidDateString(from) || !isValidDateString(to)) {
        return { error: "Necesito una fecha de inicio y una de fin válidas." };
    }

    const fromNormalized = normalizeCalendarDateString(from);
    const toNormalized = normalizeCalendarDateString(to);
    if (compareCalendarDateStrings(fromNormalized, toNormalized) > 0) {
        return { error: 'La fecha "hasta" no puede ser anterior a la fecha "desde".' };
    }

    return { value: { from: fromNormalized, to: toNormalized } };
}
