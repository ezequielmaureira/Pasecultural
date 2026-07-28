export function parse(rawValue) {
    const n = Number(rawValue);
    if (Number.isNaN(n) || n < 0) {
        return { error: "Necesito un precio válido (0 o más)." };
    }
    return { value: n };
}
