import { useCallback, useState } from "react";

// Persiste un valor en sessionStorage — sobrevive a navegar entre pantallas
// dentro de la misma pestaña/sesión, se pierde al cerrarla (a diferencia de
// localStorage, que sobreviviría entre sesiones distintas). Mismo contrato
// que useState: [value, setValue]. Genérico, sin ninguna referencia al
// Dashboard — pensado para cualquier "recordar esto mientras dure la
// sesión" que haga falta más adelante.
//
// El setter es estable (useCallback) a propósito: con más de un consumidor
// (ActiveEventContext, el selector de categorías del Dashboard) que lo
// pasan a efectos/callbacks propios, una identidad nueva en cada render
// obligaría a cada uno a silenciar el lint de dependencias o arriesgarse a
// loops — más fácil resolverlo acá, una sola vez.
export function useSessionStorageState(key, defaultValue) {
  const [value, setValue] = useState(() => {
    try {
      const stored = sessionStorage.getItem(key);
      return stored !== null ? JSON.parse(stored) : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  const setPersistedValue = useCallback(
    (next) => {
      setValue((current) => {
        const resolved = typeof next === "function" ? next(current) : next;
        try {
          sessionStorage.setItem(key, JSON.stringify(resolved));
        } catch {
          // sessionStorage puede fallar (modo privado, cuota llena) — el
          // estado en memoria sigue funcionando igual, sólo no persiste
          // entre navegaciones.
        }
        return resolved;
      });
    },
    [key]
  );

  return [value, setPersistedValue];
}
