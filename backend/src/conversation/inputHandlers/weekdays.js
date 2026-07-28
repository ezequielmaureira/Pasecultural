// Índices 0=Lunes .. 6=Domingo, igual que el resto del selector de fechas
// del frontend (DateAnswer/DatePicker ya usan esta misma convención).
export function parse(rawValue) {
    if (!Array.isArray(rawValue) || rawValue.length === 0) {
        return { error: "Elegí al menos un día de la semana." };
    }

    const days = [...new Set(rawValue.map(Number))];
    const valid = days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6);
    if (!valid) {
        return { error: "Elegí al menos un día de la semana." };
    }

    return { value: days.sort((a, b) => a - b) };
}
