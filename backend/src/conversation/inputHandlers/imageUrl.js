import { isValidHttpUrl } from "../../utils/mediaParser.js";

// La imagen ya fue subida por el cliente a POST /api/media/upload (mismo
// endpoint que usa el wizard web hoy vía ImageUploader); acá sólo llega y se
// valida la URL resultante, el Engine no reimplementa el upload.
export function parse(rawValue) {
    const value = typeof rawValue === "string" ? rawValue.trim() : "";
    if (!value || !isValidHttpUrl(value)) {
        return {
            error: "Subí la imagen a /api/media/upload y mandame la URL que te devuelve.",
        };
    }
    return { value };
}
