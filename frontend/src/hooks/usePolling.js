import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_INTERVAL_MS = 10000;

// Infraestructura genérica de "datos vivos" por polling — no sabe nada de
// HTTP, del Dashboard, ni de ningún dominio (ventas, scanners, tickets...).
// Sólo orquesta CUÁNDO se llama a `fetcher`; el CÓMO se obtienen los datos
// es enteramente responsabilidad del caller. Ver usePolling.md para el
// contrato completo y el plan de migración a WebSockets/SSE.
//
// `enabled`: si es false, no hace ningún fetch (ni el inicial) y limpia
// `data` — "todavía no hay nada que buscar" (ej. sin evento destacado).
// `polling`: si es false, hace la carga inicial pero no arma el intervalo —
// "traé una vez, no repitas" (ej. evento destacado pero no en curso).
// `deps`: identifica QUÉ se está pidiendo (ej. `[eventId]`) — cambiar `deps`
// reinicia todo el ciclo (carga inicial + intervalo) de cero, descartando
// cualquier respuesta en vuelo del ciclo anterior.
export function usePolling(fetcher, { intervalMs = DEFAULT_INTERVAL_MS, enabled = true, polling = true, deps = [] } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(null);

  // El fetcher se guarda en un ref (no en el arreglo de dependencias del
  // efecto) para que el caller no tenga que memoizarlo con useCallback para
  // que esto funcione bien — siempre se llama la versión más reciente, sin
  // que un fetcher "nuevo" en cada render reinicie el ciclo de polling por
  // su cuenta. Lo único que reinicia el ciclo es un cambio real en `deps`.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  // Token de request: cualquier respuesta que llegue después de que el
  // token haya cambiado (por un fetch más nuevo, o porque el ciclo se
  // reinició) se descarta — evita que una respuesta lenta y vieja pise
  // datos más nuevos.
  const requestIdRef = useRef(0);

  const runFetch = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    try {
      const result = await fetcherRef.current();
      if (requestId !== requestIdRef.current) return;
      setData(result);
      setError(null);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Invalida cualquier fetch en vuelo del ciclo anterior antes de decidir
    // qué hacer con este.
    requestIdRef.current += 1;

    if (!enabled) {
      setData(null);
      setError(null);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    runFetch();

    if (!polling) return undefined;

    // Único intervalo activo a la vez: `start`/`stop` son idempotentes
    // (`start` no hace nada si ya hay uno corriendo), y el cleanup de este
    // efecto SIEMPRE llama `stop` antes de que React vuelva a ejecutar el
    // efecto (por un cambio de `deps`/`enabled`/`polling`/`intervalMs`) o
    // lo desmonte — nunca pueden quedar dos corriendo en paralelo.
    let intervalId = null;
    function start() {
      if (intervalId) return;
      intervalId = setInterval(runFetch, intervalMs);
    }
    function stop() {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    }
    // Page Visibility API: pestaña oculta -> se detiene de verdad (no sólo
    // se "saltea" el fetch); al volver, refresco inmediato y se reanuda.
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        runFetch();
        start();
      } else {
        stop();
      }
    }

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
    // `deps` se spread acá a propósito: este hook es genérico y no conoce
    // de antemano qué identifica "qué se está pidiendo" para cada caller.
    // El arreglo debe tener siempre el mismo largo entre renders para un
    // mismo call site (mismo criterio que cualquier arreglo de dependencias
    // de React) — el caller es responsable de eso, igual que con useEffect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, polling, intervalMs, runFetch, ...deps]);

  return { data, loading, error, refetch: runFetch };
}
