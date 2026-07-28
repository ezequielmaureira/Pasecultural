// rawValue debe ser el id de una de las `options` que trae el Prompt del paso actual.
export function parse(rawValue, { options }) {
    const id = typeof rawValue === "string" ? rawValue.trim() : "";
    const found = (options ?? []).find((opt) => opt.id === id);
    if (!found) {
        return { error: "Elegí una de las opciones que te muestro." };
    }
    return { value: found.id };
}
