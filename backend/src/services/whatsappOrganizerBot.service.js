// Fase 2E — lógica de presentación específica de WhatsApp: NO reimplementa
// ninguna regla de EventCreationEngine, sólo (a) decide qué hacer ANTES de
// que exista una conversación (saludo/afirmativo/negativo) y (b) traduce la
// respuesta REAL del motor a un texto plano. El motor nunca se entera de
// que este texto va a Meta.

export const WHATSAPP_DECLINE_TEXT = "Perfecto 👍 Cuando quieras publicar un evento, escribime.";

export const WHATSAPP_CANCEL_TEXT = "❌ Cancelamos la creación de tu evento. Cuando quieras, escribime para empezar de nuevo.";

// Fase 2F — se usan cuando la intención es AFFIRMATIVE pero
// resolveWhatsappOrganizerIdentity todavía no encuentra un vínculo
// verificado para este wa_id (ver whatsappOrganizerIdentity.service.js):
// nunca se llega a EventCreationEngine.start en ese caso, se dispara el
// challenge de vinculación (whatsappOrganizerLink.service.js) en su lugar.
export function buildWhatsappLinkChallengeText(code) {
    return `Para vincular este WhatsApp con tu cuenta de PaseCultural, ingresá este código en tu panel de organizador:\n\n${code}\n\nEl código vence en 10 minutos.`;
}

// Ya había un challenge vigente para este wa_id y todavía no pasó el
// cooldown de reemplazo (ver shouldCreateNewChallenge) — no se genera un
// código nuevo ni se puede reenviar el anterior (nunca se guarda en texto
// plano), así que sólo se avisa que ya hay uno esperando.
export const WHATSAPP_LINK_CHALLENGE_PENDING_TEXT =
    "Ya te enviamos un código para vincular este WhatsApp. Revisá los mensajes anteriores; si no te llegó, esperá un minuto y volvé a escribir.";

// ==================================================================
// classifyInitialIntent — SOLO para el mensaje previo a iniciar el motor
// (sección 3B/3C/3D del pedido). Determinística, sin IA: normaliza
// mayúsculas/tildes/espacios/signos simples y compara contra un set fijo
// de frases — no es un NLP, no interpreta nada fuera de esa lista.
// ==================================================================

function normalizeIntentText(text) {
    return text
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // tildes
        .toLowerCase()
        .replace(/[¡!¿?.,]/g, "") // signos simples
        .replace(/\s+/g, " ")
        .trim();
}

const AFFIRMATIVE_PHRASES = new Set(["si", "s", "dale", "ok", "quiero", "quiero publicar", "publicar", "crear", "crear evento"]);

const NEGATIVE_PHRASES = new Set(["no", "no gracias", "ahora no", "despues"]);

export function classifyInitialIntent(text) {
    if (typeof text !== "string") return "UNKNOWN";
    const normalized = normalizeIntentText(text);
    if (!normalized) return "UNKNOWN";
    if (AFFIRMATIVE_PHRASES.has(normalized)) return "AFFIRMATIVE";
    if (NEGATIVE_PHRASES.has(normalized)) return "NEGATIVE";
    return "UNKNOWN";
}

// ==================================================================
// isCancelCommand — sección 8: sólo estas 3 palabras, sólo con
// conversación activa (lo decide el controller, no esta función).
// ==================================================================

const CANCEL_COMMANDS = new Set(["cancelar", "cancel", "salir"]);

export function isCancelCommand(text) {
    if (typeof text !== "string") return false;
    return CANCEL_COMMANDS.has(normalizeIntentText(text));
}

// ==================================================================
// extractWhatsappReplyText — toma la respuesta REAL de
// EventCreationEngine.start/handleInput (ver toConversationResult/
// handlePreviewInput en EventCreationEngine.js) y devuelve el texto plano
// a mandar por WhatsApp. Nunca manda el objeto crudo ni metadata interna
// (sections, canGoBack, currentValue, draft completo, etc.).
// ==================================================================

export function extractWhatsappReplyText(engineResult) {
    if (!engineResult) return null;

    // handlePreviewInput terminó el flujo con PUBLISH/DRAFT: {conversationId, done:true, status, event}.
    if (engineResult.done) {
        return engineResult.status === "PUBLISHED"
            ? "🎉 ¡Listo! Tu evento ya está publicado."
            : "📝 Guardamos tu evento como borrador.";
    }

    const prompt = engineResult.prompt;
    if (!prompt) return null;

    // El paso PREVIEW no tiene `text` (trae `draft` completo, ver
    // buildPrompt) — publicar/guardar borrador por comando de texto libre
    // queda fuera del alcance de esta fase (sección 8: sólo se mapea
    // cancelar). Se informa sin filtrar el draft ni pedir un comando que
    // todavía no existe.
    if (prompt.type === "PREVIEW") {
        return prompt.error
            ? `⚠️ ${prompt.error}`
            : "Llegaste al resumen final de tu evento. Por ahora, terminá de revisarlo y publicarlo desde la web de PaseCultural.";
    }

    // type === "QUESTION" — si el motor marcó un error de validación sobre
    // la respuesta anterior, va primero, seguido de la pregunta reenviada
    // (mismo prompt, ver buildPrompt): respeta el orden "primero el error,
    // después qué hacer".
    return prompt.error ? `⚠️ ${prompt.error}\n\n${prompt.text}` : prompt.text;
}
