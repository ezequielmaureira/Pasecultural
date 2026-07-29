import { isValidTimeString } from "./time.js";

// Uno o varios horarios (inicio/fin) para la misma recurrencia. El motor
// cruza cada horario con cada fecha que matchea días de semana + rango.
export function parse(rawValue) {
    if (!Array.isArray(rawValue) || rawValue.length === 0) {
        return { error: "Agregá al menos un horario." };
    }

    const schedules = [];
    for (const item of rawValue) {
        if (!isValidTimeString(item?.startTime) || !isValidTimeString(item?.endTime)) {
            return { error: "Cada horario necesita hora de inicio y de fin válidas." };
        }
        schedules.push({ startTime: item.startTime, endTime: item.endTime });
    }

    return { value: schedules };
}
