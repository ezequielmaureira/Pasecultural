import { isValidHttpUrl } from "../../utils/mediaParser.js";

// Fest Pass — el video ya fue descargado de Meta y subido a Cloudinary por
// whatsapp.controller.js (vía uploadWhatsappVideoMessage) ANTES de llamar al
// motor: este handler nunca hace red ni conoce Meta/Cloudinary, sólo valida
// el contrato interno ya resuelto {url, publicId} — mismo criterio que
// imageUrl.js (que tampoco sube nada, sólo valida la URL ya subida por Web).
// Cualquier otra cosa (texto libre, null, objeto sin los dos campos) es un
// error conversacional simple: "Mandame un video para continuar." — nunca
// un detalle técnico.
export function parse(rawValue) {
    const url = typeof rawValue?.url === "string" ? rawValue.url.trim() : "";
    const publicId = typeof rawValue?.publicId === "string" ? rawValue.publicId.trim() : "";

    if (!url || !isValidHttpUrl(url) || !publicId) {
        return { error: "Mandame un video para continuar." };
    }

    return { value: { url, publicId } };
}
