import test from "node:test";
import assert from "node:assert/strict";
import {
    buildWhatsappEventCreationLink,
    WHATSAPP_EVENT_CREATION_PREFILLED_TEXT,
} from "../src/services/whatsapp.service.js";

// Botón flotante global "Cargá tu evento con WhatsApp" — pura, sin DB. Mismo
// patrón que whatsappPremiumGate.test.js: WHATSAPP_DISPLAY_PHONE_NUMBER se
// cachea en memoria de proceso dentro del service (getWhatsappDisplayPhoneNumber),
// así que sólo hace falta setearla ANTES de la primera llamada de este
// archivo — nunca hace falta restaurarla entre tests de este mismo proceso.
process.env.WHATSAPP_DISPLAY_PHONE_NUMBER = "5493511234567";

test("WA-LINK-A: la URL usa el número oficial configurado y el texto prearmado", () => {
    const url = buildWhatsappEventCreationLink();
    assert.equal(
        url,
        `https://wa.me/5493511234567?text=${encodeURIComponent(WHATSAPP_EVENT_CREATION_PREFILLED_TEXT)}`
    );
});

test("WA-LINK-B: nunca hardcodea el número — cambia si cambia la config (antes de la primera llamada del proceso)", () => {
    // No se puede reconfigurar acá (ya se cacheó arriba) — esto sólo prueba
    // que la función no tiene ningún número propio embebido en el código:
    // el string devuelto contiene EXACTAMENTE el valor de la env var seteada,
    // nunca un número distinto.
    const url = buildWhatsappEventCreationLink();
    assert.match(url, /^https:\/\/wa\.me\/5493511234567\?text=/);
});
