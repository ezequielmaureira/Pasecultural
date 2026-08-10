import test from "node:test";
import assert from "node:assert/strict";
import { parseWhatsappFunctionCardText } from "../src/services/whatsappOrganizerBot.service.js";

// Bug fix (UX y validación de fecha) — parseWhatsappFunctionCardText es la
// única función que traduce el texto libre de WhatsApp ("DD/MM/AAAA HH:MM a
// HH:MM") al shape {date, startTime, endTime} que ya exige
// inputHandlers/functionCard.js. Reutiliza los validadores REALES del motor
// (isValidCalendarDateString/isValidTimeString) — nunca un regex a secas
// para la validez de la fecha/horario en sí, sólo para reconocer la FORMA
// del mensaje.

test("25/08/2026 20:00 a 23:00 -> fecha válida, se transforma al shape exacto del motor", () => {
    assert.deepEqual(parseWhatsappFunctionCardText("25/08/2026 20:00 a 23:00"), {
        date: "2026-08-25",
        startTime: "20:00",
        endTime: "23:00",
    });
});

test("01/12/2026 18:30 a 21:00 -> fecha válida", () => {
    assert.deepEqual(parseWhatsappFunctionCardText("01/12/2026 18:30 a 21:00"), {
        date: "2026-12-01",
        startTime: "18:30",
        endTime: "21:00",
    });
});

test("31/02/2026 (día inexistente para febrero) -> inválido, aunque matchee la forma DD/MM/AAAA", () => {
    assert.equal(parseWhatsappFunctionCardText("31/02/2026 20:00 a 23:00"), null);
});

test("32/08/2026 (día fuera de rango) -> inválido", () => {
    assert.equal(parseWhatsappFunctionCardText("32/08/2026 20:00 a 23:00"), null);
});

test("00/10/2026 (día cero) -> inválido", () => {
    assert.equal(parseWhatsappFunctionCardText("00/10/2026 20:00 a 23:00"), null);
});

test("texto cualquiera, sin ninguna forma de fecha -> inválido", () => {
    assert.equal(parseWhatsappFunctionCardText("el evento es el próximo sábado"), null);
    assert.equal(parseWhatsappFunctionCardText("no sé todavía"), null);
    assert.equal(parseWhatsappFunctionCardText(""), null);
});

test("nunca acepta día/mes de un solo dígito (formato oficial es estrictamente DD/MM/AAAA de 2 dígitos)", () => {
    assert.equal(parseWhatsappFunctionCardText("25/8/2026 20:00 a 23:00"), null);
    assert.equal(parseWhatsappFunctionCardText("5/08/2026 20:00 a 23:00"), null);
});

test("nunca acepta separadores distintos a '/' (guion o punto)", () => {
    assert.equal(parseWhatsappFunctionCardText("25-08-2026 20:00 a 23:00"), null);
    assert.equal(parseWhatsappFunctionCardText("25.08.2026 20:00 a 23:00"), null);
});

test("un horario inválido (hora fuera de rango o minutos inválidos) es rechazado aunque la fecha sea real", () => {
    assert.equal(parseWhatsappFunctionCardText("25/08/2026 25:00 a 23:00"), null);
    assert.equal(parseWhatsappFunctionCardText("25/08/2026 20:00 a 23:61"), null);
});

test("un horario de un solo dígito de hora (sin cero adelante) es rechazado — mismo criterio que ya exige el motor (isValidTimeString)", () => {
    assert.equal(parseWhatsappFunctionCardText("25/08/2026 9:00 a 23:00"), null);
});

test("tolera espacios extra entre fecha, horarios y la palabra 'a', y 'A' en mayúscula", () => {
    assert.deepEqual(parseWhatsappFunctionCardText("  25/08/2026   20:00   a   23:00  "), {
        date: "2026-08-25",
        startTime: "20:00",
        endTime: "23:00",
    });
    assert.deepEqual(parseWhatsappFunctionCardText("25/08/2026 20:00 A 23:00"), {
        date: "2026-08-25",
        startTime: "20:00",
        endTime: "23:00",
    });
});

test("no aplica ninguna regla de fecha pasada/mínima/máxima que el motor no exija hoy — sólo valida existencia real del día", () => {
    // Año 2020 (pasado respecto a la fecha actual del sistema) sigue siendo
    // una fecha de calendario válida: el motor no tiene esa regla hoy, y el
    // pedido explícitamente prohíbe inventarla acá.
    assert.deepEqual(parseWhatsappFunctionCardText("25/08/2020 20:00 a 23:00"), {
        date: "2020-08-25",
        startTime: "20:00",
        endTime: "23:00",
    });
});

test("never throws on non-string/null/undefined input", () => {
    assert.equal(parseWhatsappFunctionCardText(null), null);
    assert.equal(parseWhatsappFunctionCardText(undefined), null);
    assert.equal(parseWhatsappFunctionCardText(12345), null);
    assert.equal(parseWhatsappFunctionCardText({}), null);
});
