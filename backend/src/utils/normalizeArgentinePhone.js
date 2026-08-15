// Fase 2G — normalización SEGURA de teléfonos argentinos para comparar
// Organization.phone contra el wa_id real que manda Meta. Deliberadamente
// distinta de normalizeWhatsappOutboundRecipient (whatsapp.service.js): esa
// otra función sólo ajusta el FORMATO DE SALIDA hacia Meta bajo
// WHATSAPP_TEST_MODE, nunca decide identidad; ésta es la única fuente para
// decidir "¿este número es el mismo que aquel?".
//
// Reduce cualquier formato de entrada a un "número nacional significativo"
// de 10 dígitos (código de área + número local, sin 54, sin el 9 de móvil,
// sin el 0 de discado nacional) — o `null` si no se puede interpretar con
// certeza. La comparación de identidad SIEMPRE debe ser igualdad exacta
// entre dos resultados de esta función, nunca comparar substrings/sufijos:
// dos números de área distintos pueden compartir el mismo número local
// final (ej. 358-4123456 vs 351-4123456) y no deben coincidir jamás.
const SIGNIFICANT_NUMBER_LENGTH = 10;

export function normalizeArgentinePhoneForMatching(rawPhone) {
    if (typeof rawPhone !== "string") return null;

    const digitsOnly = rawPhone.replace(/\D/g, "");
    if (!digitsOnly) return null;

    let significant;
    if (digitsOnly.startsWith("549")) {
        // +54 9 ... / 549... — formato internacional de móvil argentino.
        significant = digitsOnly.slice(3);
    } else if (digitsOnly.startsWith("54")) {
        // +54 ... / 54... — internacional sin el 9 de móvil.
        significant = digitsOnly.slice(2);
    } else if (digitsOnly.startsWith("0")) {
        // 0... — discado nacional dentro de Argentina.
        significant = digitsOnly.slice(1);
    } else {
        // Ya viene como número local/nacional sin prefijos.
        significant = digitsOnly;
    }

    // Longitud inválida = no se puede afirmar con certeza qué número es:
    // se rechaza (null) en vez de adivinar. Nunca se recorta ni se
    // completa para forzar una coincidencia.
    return significant.length === SIGNIFICANT_NUMBER_LENGTH ? significant : null;
}

// Azúcar para el caso de uso real (whatsappOrganizerDiscovery.service.js):
// dos teléfonos "son el mismo" sólo si ambos normalizan a un valor no nulo
// Y ese valor es idéntico — nunca por sufijo/contains/heurística.
export function isSameArgentinePhone(phoneA, phoneB) {
    const normalizedA = normalizeArgentinePhoneForMatching(phoneA);
    const normalizedB = normalizeArgentinePhoneForMatching(phoneB);
    return Boolean(normalizedA) && normalizedA === normalizedB;
}

// Fase — cambio de número de WhatsApp autorizado. A diferencia de
// normalizeArgentinePhoneForMatching (que reduce a un número "significativo"
// de 10 dígitos SIN el 9 de móvil, sólo para COMPARAR si dos teléfonos son
// el mismo), esta función arma el waId COMPLETO en el formato exacto que
// Meta usa y que ya escriben WhatsappOrganizerLink.waId/ConversationState.channelRef
// en producción (ej. "5491122334455") — 54 + 9 + el mismo número
// significativo de 10 dígitos. Reutiliza la MISMA extracción de dígitos
// significativos (nunca duplica esa lógica de parseo): si
// normalizeArgentinePhoneForMatching no puede interpretar el número con
// certeza, esto tampoco puede — nunca arma un waId a partir de una
// interpretación ambigua, nunca "adivina" el 9 de móvil si el número
// original no permitía confirmarlo.
export function buildArgentineWhatsappId(rawPhone) {
    const significant = normalizeArgentinePhoneForMatching(rawPhone);
    return significant ? `549${significant}` : null;
}
