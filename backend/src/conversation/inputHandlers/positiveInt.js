export function parse(rawValue) {
    const n = Number(rawValue);
    if (!Number.isInteger(n) || n < 1) {
        return { error: "Necesito un número entero mayor a 0." };
    }
    return { value: n };
}
