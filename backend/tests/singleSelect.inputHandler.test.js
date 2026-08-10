import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../src/conversation/inputHandlers/singleSelect.js";

// Regresión — bug de WhatsApp (categorías no mostradas): la corrección
// vive ENTERAMENTE en el adaptador de WhatsApp (whatsappOrganizerBot.service.js
// / whatsapp.controller.js). Este test prueba que el motor compartido
// (steps/definitions.js + este handler, el mismo que usa Web) sigue exigiendo
// el `id` real de una opción y NUNCA acepta un índice numérico — si este
// test se rompiera, significaría que alguien tocó la semántica del motor,
// lo cual el pedido explícitamente prohibió.

const OPTIONS = [
    { id: "MUSICA", label: "Música" },
    { id: "TEATRO", label: "Teatro" },
];

test("singleSelect.parse still requires the real option id, unchanged by the WhatsApp fix", () => {
    assert.deepEqual(parse("MUSICA", { options: OPTIONS }), { value: "MUSICA" });
});

test("singleSelect.parse still rejects a bare numeric index — it is not the id of any real option", () => {
    const result = parse("1", { options: OPTIONS });
    assert.equal(result.value, undefined);
    assert.equal(result.error, "Elegí una de las opciones que te muestro.");
});

test("singleSelect.parse still rejects unknown/empty input exactly as before", () => {
    assert.equal(parse("OTRA_COSA", { options: OPTIONS }).error, "Elegí una de las opciones que te muestro.");
    assert.equal(parse("", { options: OPTIONS }).error, "Elegí una de las opciones que te muestro.");
});
