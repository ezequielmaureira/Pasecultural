import { useEffect, useRef } from "react";

// Convierte un back-press del navegador/hardware en una acción DENTRO del
// flujo del Scanner, en vez de dejar que la app salga de /scanner —
// mientras `enabled` sea true, jamás llega a navegar al historial real
// (login, Home, lo que hubiera antes). No es un trap ciego de "reempujar
// para siempre sin sentido": cada back-press dispara `onBack`, que decide
// qué significa "atrás" en el momento exacto en el que se lo presiona
// (cancelar una confirmación pendiente, volver un nivel dentro de las
// fases del Scanner, o no hacer nada si ya no hay a dónde volver).
//
// Por qué esto y no react-router: `useBlocker` (la herramienta nativa para
// interceptar navegación, incluida POP) sólo funciona con un data router
// (`createBrowserRouter`/`RouterProvider`) — esta app usa `<BrowserRouter>`
// declarativo en toda su superficie, y migrar el router entero para esto
// sería un cambio enorme y no relacionado. La History API es la única
// herramienta disponible bajo ese modo; se usa acá de la forma más acotada
// posible: UNA sola entrada "guardia" (nunca una pila creciente por cada
// pantalla), re-armada en el momento exacto en que se consume.
//
// Nota de implementación: la entrada empujada nunca se "desarma" al
// desmontar (hacer history.back() ahí dispararía su propio popstate y
// podría confundirse con un back-press real del usuario) — queda ahí,
// inerte, apuntando a la misma URL. Es intencional y sin costo real: como
// mucho absorbe un back-press invisible de más el día que el operador
// realmente se vaya.
export function useScannerBackGuard(enabled, onBack) {
    const onBackRef = useRef(onBack);
    useEffect(() => {
        onBackRef.current = onBack;
    }, [onBack]);

    useEffect(() => {
        if (!enabled) return undefined;

        window.history.pushState({ scannerBackGuard: true }, "");

        function handlePopState() {
            window.history.pushState({ scannerBackGuard: true }, "");
            onBackRef.current();
        }

        window.addEventListener("popstate", handlePopState);
        return () => {
            window.removeEventListener("popstate", handlePopState);
        };
    }, [enabled]);
}
