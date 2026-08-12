import test from "node:test";
import assert from "node:assert/strict";
import {
    parseWhatsappFunctionCardDateText,
    getArgentinaTodayDateString,
    isArgentineDateInThePast,
} from "../src/services/whatsappOrganizerBot.service.js";

// Fase 3C — parseWhatsappFunctionCardDateText reemplaza a
// parseWhatsappFunctionCardText (formato compuesto, eliminado): ahora sólo
// reconoce una fecha sola, reutilizando los mismos validadores reales del
// motor (isValidCalendarDateString/normalizeCalendarDateString).
//
// Fase 3K — el año pasa a ser OPCIONAL (se enseña DD/MM; DD/MM/AAAA sigue
// funcionando tal cual) y día/mes aceptan 1 o 2 dígitos ("6/8" == "06/08")
// — ver los tests de esa sección más abajo.

test("25/08/2026 -> se normaliza a 2026-08-25", () => {
    assert.equal(parseWhatsappFunctionCardDateText("25/08/2026"), "2026-08-25");
});

test("01/12/2026 -> se normaliza a 2026-12-01", () => {
    assert.equal(parseWhatsappFunctionCardDateText("01/12/2026"), "2026-12-01");
});

test("31/02/2026 (día inexistente para febrero) -> inválida", () => {
    assert.equal(parseWhatsappFunctionCardDateText("31/02/2026"), null);
});

test("32/08/2026 (día fuera de rango) -> inválida", () => {
    assert.equal(parseWhatsappFunctionCardDateText("32/08/2026"), null);
});

test("00/08/2026 (día cero) -> inválida", () => {
    assert.equal(parseWhatsappFunctionCardDateText("00/08/2026"), null);
});

test("nunca acepta separadores distintos a '/' (guion o punto)", () => {
    assert.equal(parseWhatsappFunctionCardDateText("25-08-2026"), null);
    assert.equal(parseWhatsappFunctionCardDateText("25.08.2026"), null);
});

test("Fase 3K: día/mes de un solo dígito son válidos, con o sin año (tolerante en lo que entiende)", () => {
    assert.equal(parseWhatsappFunctionCardDateText("25/8/2026"), "2026-08-25");
    assert.equal(parseWhatsappFunctionCardDateText("5/08/2026"), "2026-08-05");
});

test("texto libre nunca se interpreta como fecha", () => {
    assert.equal(parseWhatsappFunctionCardDateText("mañana"), null);
    assert.equal(parseWhatsappFunctionCardDateText("el próximo sábado"), null);
    assert.equal(parseWhatsappFunctionCardDateText(""), null);
});

test("el formato compuesto viejo (Fase anterior) ya no es una fecha válida por sí solo", () => {
    // "25/08/2026 20:00 a 23:00" ya no es la UX aceptada — como texto de
    // SOLO fecha, ni siquiera matchea el patrón DD/MM/AAAA (le sobra todo
    // lo de después).
    assert.equal(parseWhatsappFunctionCardDateText("25/08/2026 20:00 a 23:00"), null);
});

test("tolera espacios extra alrededor", () => {
    assert.equal(parseWhatsappFunctionCardDateText("  25/08/2026  "), "2026-08-25");
});

test("never throws on non-string input", () => {
    assert.equal(parseWhatsappFunctionCardDateText(null), null);
    assert.equal(parseWhatsappFunctionCardDateText(undefined), null);
    assert.equal(parseWhatsappFunctionCardDateText(12345), null);
});

// ==================================================
// Fase 3K — DD/MM sin año: se infiere el PRÓXIMO DD/MM que corresponda.
// ==================================================

test("DD/MM sin año, todavía no pasó este año -> usa el año actual", () => {
    const now = new Date("2026-08-12T15:00:00.000Z"); // 12/08/2026 en Argentina
    assert.equal(parseWhatsappFunctionCardDateText("26/08", now), "2026-08-26");
});

test("DD/MM sin año, ya pasó este año -> rueda al año siguiente (nunca al pasado)", () => {
    const now = new Date("2026-08-12T15:00:00.000Z");
    assert.equal(parseWhatsappFunctionCardDateText("01/01", now), "2027-01-01");
});

test("DD/MM sin año == hoy -> se toma como hoy (no rueda al año siguiente)", () => {
    const now = new Date("2026-08-12T15:00:00.000Z"); // 12/08 en Argentina
    assert.equal(parseWhatsappFunctionCardDateText("12/08", now), "2026-08-12");
});

test("DD/MM sin año sigue rechazando una fecha inexistente (31/02)", () => {
    const now = new Date("2026-08-12T15:00:00.000Z");
    assert.equal(parseWhatsappFunctionCardDateText("31/02", now), null);
});

// ==================================================
// getArgentinaTodayDateString — "hoy" para Argentina (UTC-03:00 fijo, sin
// depender de la timezone del proceso de Node, que en Render corre en UTC).
// ==================================================

test("un instante después de medianoche en Argentina ya cuenta como el día nuevo", () => {
    // 2026-08-11T03:00:00Z = 2026-08-11T00:00:00 ART (UTC-3)
    const now = new Date("2026-08-11T03:00:00.000Z");
    assert.equal(getArgentinaTodayDateString(now), "2026-08-11");
});

test("un instante antes de medianoche en Argentina todavía es el día anterior, aunque en UTC ya sea el día siguiente", () => {
    // 2026-08-11T02:30:00Z = 2026-08-10T23:30:00 ART (todavía 10 de agosto en Argentina)
    const now = new Date("2026-08-11T02:30:00.000Z");
    assert.equal(getArgentinaTodayDateString(now), "2026-08-10");
});

// ==================================================
// Validación final previa al commit — 4 instantes EXACTOS pedidos
// explícitamente, alrededor de las dos medianoches de un mismo fin de
// semana (11 y 12 de agosto de 2026), para descartar cualquier duda sobre
// el límite real UTC-03:00.
// ==================================================

test("A) UTC 2026-08-12 02:59 -> Argentina 2026-08-11 23:59 -> 2026-08-11", () => {
    const now = new Date("2026-08-12T02:59:00.000Z");
    assert.equal(getArgentinaTodayDateString(now), "2026-08-11");
});

test("B) UTC 2026-08-12 03:00 -> Argentina 2026-08-12 00:00 -> 2026-08-12", () => {
    const now = new Date("2026-08-12T03:00:00.000Z");
    assert.equal(getArgentinaTodayDateString(now), "2026-08-12");
});

test("C) UTC 2026-08-11 03:00 -> Argentina 2026-08-11 00:00 -> 2026-08-11", () => {
    const now = new Date("2026-08-11T03:00:00.000Z");
    assert.equal(getArgentinaTodayDateString(now), "2026-08-11");
});

test("D) UTC 2026-08-11 02:59 -> Argentina 2026-08-10 23:59 -> 2026-08-10", () => {
    const now = new Date("2026-08-11T02:59:00.000Z");
    assert.equal(getArgentinaTodayDateString(now), "2026-08-10");
});

// La comparación fecha >= hoy usa exclusivamente el día calendario
// argentino derivado arriba — nunca la timezone del proceso de Node (en
// este mismo proceso de test, sea cual sea esa timezone, los 4 casos A-D ya
// probaron que el resultado no depende de ella: sólo depende del offset fijo
// -03:00 aplicado al instante UTC inyectado).
test("el límite exacto de fecha >= hoy usa el día calendario argentino en los 4 instantes A-D, nunca la timezone del proceso", () => {
    const caseB = new Date("2026-08-12T03:00:00.000Z"); // ya es 12/08 en Argentina
    assert.equal(isArgentineDateInThePast("2026-08-11", caseB), true, "11/08 ya pasó apenas empieza el 12/08 argentino");
    assert.equal(isArgentineDateInThePast("2026-08-12", caseB), false, "12/08 es justo hoy, no es pasado");

    const caseA = new Date("2026-08-12T02:59:00.000Z"); // todavía 11/08 en Argentina
    assert.equal(isArgentineDateInThePast("2026-08-12", caseA), false, "12/08 todavía es futuro, faltan 1min de reloj argentino");
    assert.equal(isArgentineDateInThePast("2026-08-11", caseA), false, "11/08 es justo hoy en ese instante");
});

// ==================================================
// isArgentineDateInThePast — sección 5/6 del pedido.
// ==================================================

test("una fecha anterior a hoy (Argentina) es pasada", () => {
    const now = new Date("2026-08-11T12:00:00.000Z"); // 09:00 ART, sigue siendo 11/08 en Argentina
    assert.equal(isArgentineDateInThePast("2026-08-10", now), true);
});

test("la fecha de hoy (Argentina) NO es pasada", () => {
    const now = new Date("2026-08-11T12:00:00.000Z");
    assert.equal(isArgentineDateInThePast("2026-08-11", now), false);
});

test("una fecha futura NO es pasada", () => {
    const now = new Date("2026-08-11T12:00:00.000Z");
    assert.equal(isArgentineDateInThePast("2026-08-12", now), false);
});

test("el límite exacto respeta la hora Argentina, no la hora UTC del servidor", () => {
    // 2026-08-11T02:00:00Z = 2026-08-10T23:00:00 ART: en UTC "ya es 11",
    // pero en Argentina todavía es 10 — "2026-08-11" debe seguir contando
    // como fecha FUTURA (no pasada) en ese instante.
    const now = new Date("2026-08-11T02:00:00.000Z");
    assert.equal(isArgentineDateInThePast("2026-08-11", now), false);
    assert.equal(isArgentineDateInThePast("2026-08-10", now), false);
});
