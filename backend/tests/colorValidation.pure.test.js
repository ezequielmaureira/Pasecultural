import test from "node:test";
import assert from "node:assert/strict";
import { isValidHexColor } from "../src/utils/colorValidation.js";

// Premium — Fase 2A. Validación pura, sin DB — ver el informe de entrega.

test("COLOR-A: #RRGGBB válido es aceptado", () => {
    assert.equal(isValidHexColor("#7C3AED"), true);
    assert.equal(isValidHexColor("#000000"), true);
    assert.equal(isValidHexColor("#FFFFFF"), true);
    assert.equal(isValidHexColor("#a1b2c3"), true, "minúsculas también son válidas");
});

test("COLOR-B: CSS arbitrario/formatos inválidos son rechazados", () => {
    const invalid = [
        "red",
        "violet",
        "#fff",
        "#FFF",
        "rgb(124, 58, 237)",
        "rgba(124, 58, 237, 0.5)",
        "var(--org-primary)",
        "url(javascript:alert(1))",
        "linear-gradient(90deg, red, blue)",
        "#7C3AED; background: url(evil)",
        "#7C3AEDD",
        "7C3AED",
        "",
        null,
        undefined,
        123456,
        "#GGGGGG",
    ];
    for (const value of invalid) {
        assert.equal(isValidHexColor(value), false, `debería rechazar: ${JSON.stringify(value)}`);
    }
});
