import { isValidHttpUrl } from "../../utils/mediaParser.js";

export function parse(rawValue) {
    const value = typeof rawValue === "string" ? rawValue.trim() : "";
    if (!value || !isValidHttpUrl(value)) {
        return { error: "Mandame una URL válida (con http:// o https://)." };
    }
    return { value };
}
