const DOCUMENT_DIGITS_REGEX = /^\d{7,10}$/;

// Quita espacios, puntos y guiones (formatos habituales al escribir un DNI:
// "20.123.456", "20 123 456", "20-123-456") — nunca letras ni otros
// caracteres, esos hacen que la validación de abajo falle como corresponde.
export function normalizeBuyerDocument(rawDocument) {
    if (typeof rawDocument !== "string") return "";
    return rawDocument.replace(/[\s.-]/g, "");
}

// Sólo números, 7 a 10 dígitos (cubre DNI argentino y documentos de otros
// países de la región con formato similar) — se valida SOBRE el valor ya
// normalizado, nunca sobre el crudo con puntos/guiones.
export function isValidBuyerDocument(normalizedDocument) {
    return DOCUMENT_DIGITS_REGEX.test(normalizedDocument);
}
