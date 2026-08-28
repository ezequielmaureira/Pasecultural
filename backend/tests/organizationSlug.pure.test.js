import test from "node:test";
import assert from "node:assert/strict";
import { slugify, generateUniqueSlug } from "../src/utils/generateSlug.js";

// Premium — Fase 2A. Pruebas puras (sin DB) del mecanismo de slug
// reutilizado tal cual de Event.slug (utils/generateSlug.js) — ver el
// informe de entrega. `isTaken` se inyecta como función simple, nunca
// necesita Prisma real.

test("SLUG-B: normaliza acentos, mayúsculas y caracteres especiales", () => {
    assert.equal(slugify("Teatro Colón"), "teatro-colon");
    assert.equal(slugify("Centro Cultural Ñandú"), "centro-cultural-nandu");
    assert.equal(slugify("  Sala   de Ensayo!!  "), "sala-de-ensayo");
    assert.equal(slugify("Producciones S.A. (2026)"), "producciones-s-a-2026");
    assert.equal(slugify("Über Café"), "uber-cafe");
});

test("SLUG-B: dos nombres iguales producen slugs únicos cuando el primero ya está tomado", async () => {
    const taken = new Set(["teatro-colon"]);
    const isTaken = async (candidate) => taken.has(candidate);

    const first = await generateUniqueSlug("Teatro Colón", isTaken);
    assert.equal(first, "teatro-colon", "el primer candidato libre se usa tal cual");

    taken.add(first);
    const second = await generateUniqueSlug("Teatro Colón", isTaken);
    assert.notEqual(second, "teatro-colon");
    assert.match(second, /^teatro-colon-[a-z0-9]{4}$/, "colisión resuelta con sufijo aleatorio, mismo mecanismo que Event.slug");
});

test("SLUG-B: nombre vacío/sin caracteres alfanuméricos no rompe la generación", async () => {
    const slug = await generateUniqueSlug("!!!", async () => false);
    assert.ok(slug.length > 0);
});
