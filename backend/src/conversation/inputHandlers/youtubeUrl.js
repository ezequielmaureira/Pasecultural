import { isValidHttpUrl, parseMediaUrl } from "../../utils/mediaParser.js";

// Acepta videos y Shorts de YouTube; la detección real (mismo criterio que
// usa EventServicePort al guardar) la hace MediaParser, no se duplica acá.
export function parse(rawValue) {
    const value = typeof rawValue === "string" ? rawValue.trim() : "";
    if (!value || !isValidHttpUrl(value)) {
        return { error: "Mandame un link válido de YouTube (video o Short)." };
    }

    try {
        const { platform } = parseMediaUrl(value);
        if (platform !== "YOUTUBE") {
            return { error: "Por ahora sólo acepto links de YouTube (video o Short)." };
        }
    } catch {
        return { error: "Ese link de YouTube no tiene un video válido. Revisalo." };
    }

    return { value };
}
