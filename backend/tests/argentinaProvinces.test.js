import test from "node:test";
import assert from "node:assert/strict";
import { ARGENTINA_PROVINCES } from "../src/utils/argentinaProvinces.js";

// Fase 3D — única fuente de verdad del selector numerado de provincia para
// la dirección manual de WhatsApp.

test("contains exactly 24 jurisdictions (23 provincias + CABA)", () => {
    assert.equal(ARGENTINA_PROVINCES.length, 24);
});

test("every jurisdiction appears exactly once (no duplicates)", () => {
    const unique = new Set(ARGENTINA_PROVINCES);
    assert.equal(unique.size, ARGENTINA_PROVINCES.length);
});

test("includes Ciudad Autónoma de Buenos Aires", () => {
    assert.ok(ARGENTINA_PROVINCES.includes("Ciudad Autónoma de Buenos Aires"));
});

test("includes every real province by name", () => {
    const expected = [
        "Buenos Aires",
        "Catamarca",
        "Chaco",
        "Chubut",
        "Córdoba",
        "Corrientes",
        "Entre Ríos",
        "Formosa",
        "Jujuy",
        "La Pampa",
        "La Rioja",
        "Mendoza",
        "Misiones",
        "Neuquén",
        "Río Negro",
        "Salta",
        "San Juan",
        "San Luis",
        "Santa Cruz",
        "Santa Fe",
        "Santiago del Estero",
        "Tierra del Fuego",
        "Tucumán",
    ];
    for (const province of expected) {
        assert.ok(ARGENTINA_PROVINCES.includes(province), `falta "${province}"`);
    }
});
