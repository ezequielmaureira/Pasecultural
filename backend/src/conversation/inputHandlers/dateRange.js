import { isValidDateString } from "./date.js";

export function parse(rawValue) {
    const from = rawValue?.from;
    const to = rawValue?.to;

    if (!isValidDateString(from) || !isValidDateString(to)) {
        return { error: "Necesito una fecha de inicio y una de fin válidas." };
    }

    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (fromDate > toDate) {
        return { error: 'La fecha "hasta" no puede ser anterior a la fecha "desde".' };
    }

    return { value: { from: fromDate.toISOString(), to: toDate.toISOString() } };
}
