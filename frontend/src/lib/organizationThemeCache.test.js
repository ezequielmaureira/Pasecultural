import test from "node:test";
import assert from "node:assert/strict";
import {
  readOrganizationThemeCache,
  writeOrganizationThemeCache,
  clearOrganizationThemeCache,
} from "./organizationThemeCache.js";

// Organization Theme Bootstrap — Premium Fase 2D.1.2. Tests PUROS, sin
// React, sin DB, sin dependencias nuevas: mock mínimo de localStorage
// inyectado como `global.window` antes de cada test — el módulo bajo test
// nunca asume que localStorage existe (ver safeGetItem/safeSetItem), así
// que estos mocks también sirven para probar el camino "storage
// inexistente/roto" apagándolos a propósito.

function installWorkingLocalStorage() {
  const store = new Map();
  global.window = {
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => {
        store.set(key, String(value));
      },
      removeItem: (key) => {
        store.delete(key);
      },
    },
  };
  return store;
}

function installBrokenLocalStorage() {
  global.window = {
    localStorage: {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota exceeded");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    },
  };
}

function installNoLocalStorage() {
  global.window = {};
}

const VALID_DATA = {
  organizationId: "org_123",
  brandingEnabled: true,
  logo: "https://cdn.example.com/logo.png",
  brandPrimaryColor: "#BBFF00",
  brandSecondaryColor: "#000000",
};

test("1. write + read válido — round-trip completo", () => {
  installWorkingLocalStorage();
  writeOrganizationThemeCache("user_A", VALID_DATA);
  const result = readOrganizationThemeCache("user_A");

  assert.ok(result);
  assert.equal(result.clerkId, "user_A");
  assert.equal(result.organizationId, "org_123");
  assert.equal(result.brandingEnabled, true);
  assert.equal(result.logo, "https://cdn.example.com/logo.png");
  assert.equal(result.brandPrimaryColor, "#BBFF00");
  assert.equal(result.brandSecondaryColor, "#000000");
  assert.equal(typeof result.cachedAt, "number");
});

test("2. aislamiento clerkId A/B — leer B nunca devuelve el cache de A", () => {
  installWorkingLocalStorage();
  writeOrganizationThemeCache("user_A", VALID_DATA);
  writeOrganizationThemeCache("user_B", { ...VALID_DATA, brandPrimaryColor: "#FF0000" });

  const resultA = readOrganizationThemeCache("user_A");
  const resultB = readOrganizationThemeCache("user_B");

  assert.equal(resultA.brandPrimaryColor, "#BBFF00");
  assert.equal(resultB.brandPrimaryColor, "#FF0000");

  // Ninguna clave cruzada existe bajo la key del otro.
  assert.equal(readOrganizationThemeCache("user_C"), null);
});

test("3. TTL expirado — se ignora y se limpia", () => {
  const store = installWorkingLocalStorage();
  const expired = {
    clerkId: "user_A",
    organizationId: "org_123",
    brandingEnabled: true,
    logo: null,
    brandPrimaryColor: "#BBFF00",
    brandSecondaryColor: "#000000",
    cachedAt: Date.now() - 25 * 60 * 60 * 1000, // 25h — más de 24h de TTL.
  };
  store.set("pc:org-theme:user_A", JSON.stringify(expired));

  const result = readOrganizationThemeCache("user_A");
  assert.equal(result, null);
  // Se limpia como efecto colateral de detectarlo vencido.
  assert.equal(store.has("pc:org-theme:user_A"), false);
});

test("4. JSON corrupto — nunca lanza, devuelve null", () => {
  const store = installWorkingLocalStorage();
  store.set("pc:org-theme:user_A", "{ esto no es json válido");

  assert.doesNotThrow(() => {
    const result = readOrganizationThemeCache("user_A");
    assert.equal(result, null);
  });
});

test("5. estructura inválida — cada campo faltante/incorrecto se descarta", () => {
  const store = installWorkingLocalStorage();

  const cases = [
    { ...VALID_DATA, clerkId: "user_A" }, // sin cachedAt
    { clerkId: "user_A", organizationId: "", brandingEnabled: true, cachedAt: Date.now() }, // organizationId vacío
    { clerkId: "user_A", organizationId: "org_1", brandingEnabled: "true", cachedAt: Date.now() }, // brandingEnabled no boolean
    { clerkId: "user_A", organizationId: "org_1", brandingEnabled: true, brandPrimaryColor: "not-a-color", cachedAt: Date.now() },
    { clerkId: "user_A", organizationId: "org_1", brandingEnabled: true, logo: 123, cachedAt: Date.now() },
    null,
    "just a string",
    42,
  ];

  for (const invalid of cases) {
    store.set("pc:org-theme:user_A", JSON.stringify(invalid));
    assert.equal(readOrganizationThemeCache("user_A"), null, `debía descartar: ${JSON.stringify(invalid)}`);
  }
});

test("6. clearCache — borra efectivamente la entrada", () => {
  installWorkingLocalStorage();
  writeOrganizationThemeCache("user_A", VALID_DATA);
  assert.ok(readOrganizationThemeCache("user_A"));

  clearOrganizationThemeCache("user_A");
  assert.equal(readOrganizationThemeCache("user_A"), null);
});

test("7. localStorage no disponible / roto — nunca rompe la app", () => {
  installNoLocalStorage();
  assert.doesNotThrow(() => writeOrganizationThemeCache("user_A", VALID_DATA));
  assert.doesNotThrow(() => {
    const result = readOrganizationThemeCache("user_A");
    assert.equal(result, null);
  });
  assert.doesNotThrow(() => clearOrganizationThemeCache("user_A"));

  installBrokenLocalStorage();
  assert.doesNotThrow(() => writeOrganizationThemeCache("user_A", VALID_DATA));
  assert.doesNotThrow(() => {
    const result = readOrganizationThemeCache("user_A");
    assert.equal(result, null);
  });
  assert.doesNotThrow(() => clearOrganizationThemeCache("user_A"));
});

test("8. colores inválidos son rechazados en la ESCRITURA (nunca se persiste basura)", () => {
  const store = installWorkingLocalStorage();
  writeOrganizationThemeCache("user_A", { ...VALID_DATA, brandPrimaryColor: "rgb(0,0,0)" });
  assert.equal(store.has("pc:org-theme:user_A"), false);

  writeOrganizationThemeCache("user_A", { ...VALID_DATA, brandSecondaryColor: "not-a-color" });
  assert.equal(store.has("pc:org-theme:user_A"), false);

  // null es válido para ambos colores (mismo contrato que brandPrimaryColor
  // en el backend).
  writeOrganizationThemeCache("user_A", { ...VALID_DATA, brandPrimaryColor: null, brandSecondaryColor: null });
  const result = readOrganizationThemeCache("user_A");
  assert.equal(result.brandPrimaryColor, null);
  assert.equal(result.brandSecondaryColor, null);
});

test("9. clerkId interno distinto al de la key es rechazado en la LECTURA", () => {
  const store = installWorkingLocalStorage();
  const tampered = {
    clerkId: "user_OTHER",
    organizationId: "org_123",
    brandingEnabled: true,
    logo: null,
    brandPrimaryColor: "#BBFF00",
    brandSecondaryColor: "#000000",
    cachedAt: Date.now(),
  };
  // Escrito manualmente bajo la key de user_A, pero con clerkId interno de
  // otro usuario — nunca debería poder pasar en uso normal (writeCache
  // siempre usa el mismo clerkId para la key y el campo), pero se valida
  // como defensa en profundidad.
  store.set("pc:org-theme:user_A", JSON.stringify(tampered));

  assert.equal(readOrganizationThemeCache("user_A"), null);
});
