export function parse(rawValue) {
    const value = typeof rawValue === "string" ? rawValue.trim() : "";
    if (!value) {
        return { error: "Contame un poco más, no puede quedar vacío." };
    }
    return { value };
}
