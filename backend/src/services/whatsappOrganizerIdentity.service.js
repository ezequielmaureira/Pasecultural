// Fase 2E — resolución de "¿qué organizer/User real controla este número de
// WhatsApp?", el paso obligatorio antes de poder llamar
// EventCreationEngine.start({ clerkId, ... }) desde este canal.
//
// Auditoría (ver informe de entrega de Fase 2E): Organization.phone es un
// campo de texto libre, opcional, SIN @unique en el schema y SIN ningún
// flujo de verificación — a diferencia de scanners (ver
// utils/verificationCode.js + email/sendScannerVerificationCode.service.js),
// nadie confirma nunca que el organizador efectivamente controla ese
// número. Lo carga él mismo, con el formato que quiera, al crear su perfil
// de organización.
//
// Compararlo contra el wa_id entrante (ej. "549XXXXXXXXXX") sería
// inventar una identidad: cualquiera podría escribir el teléfono de otra
// organización en su propio perfil y, desde WhatsApp, actuar como si fuera
// esa organización. Por eso esta función NO intenta ningún matching por
// similitud/normalización de formato — devuelve siempre null hasta que
// exista un flujo real de verificación (ej. un código enviado por
// WhatsApp al número ya cargado, confirmado una única vez por el
// organizador, y persistido en un campo dedicado y único).
//
// clerkId es lo único que EventCreationEngine.start necesita como
// identidad — se devuelve ya con ese nombre para que el caller no tenga
// que conocer la forma interna de User/Organization.
export async function resolveWhatsappOrganizerIdentity(_whatsappPhone) {
    return null;
}
