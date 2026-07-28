export const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parse(rawValue) {
    const raw = typeof rawValue === "string" ? rawValue.trim() : "";
    if (!TIME_REGEX.test(raw)) {
        return { error: "Mandame un horario válido en formato HH:mm (ej: 21:30)." };
    }
    return { value: raw };
}

export function isValidTimeString(raw) {
    return typeof raw === "string" && TIME_REGEX.test(raw);
}
