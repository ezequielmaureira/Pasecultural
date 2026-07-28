const YES_VALUES = new Set(["si", "sí", "yes", "true"]);
const NO_VALUES = new Set(["no", "false"]);

export function parse(rawValue) {
    if (typeof rawValue === "boolean") {
        return { value: rawValue };
    }
    const normalized = typeof rawValue === "string" ? rawValue.trim().toLowerCase() : "";
    if (YES_VALUES.has(normalized)) return { value: true };
    if (NO_VALUES.has(normalized)) return { value: false };
    return { error: 'Respondé "Sí" o "No".' };
}
