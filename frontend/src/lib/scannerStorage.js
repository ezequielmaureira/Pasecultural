// Memoria del evento/función activos del Scanner — por dispositivo
// (localStorage, no sesión), tal como se aprobó en la Fase 0. Se guardan
// también los nombres (no sólo los ids) para poder pintar la pantalla de
// "Reconectando..." de inmediato, sin esperar ninguna respuesta de red.
//
// `functionId` es opcional: un scanner con más de un evento asignado puede
// elegir evento desde el selector del Dashboard sin haber elegido todavía
// una función para escanear (eso sigue pasando, sin cambios, recién al
// entrar a "Escanear"/"Historial"/"Estadísticas"). Sólo `eventId` es
// obligatorio para que la selección cuente como válida.
const STORAGE_KEY = "pasecultural:scanner:active";

export function readActiveScannerSelection() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed?.eventId) return null;
        return parsed;
    } catch {
        return null;
    }
}

export function writeActiveScannerSelection({ eventId, functionId = null, eventName, functionName = null }) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ eventId, functionId, eventName, functionName }));
}

export function clearActiveScannerSelection() {
    localStorage.removeItem(STORAGE_KEY);
}
