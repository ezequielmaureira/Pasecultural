// Única fuente de verdad de cómo se ve/cuánto dura cada resultado de
// escaneo — los números vienen de la Fase 0 aprobada, salvo VALID que esta
// fase pidió explícitamente acortar a 700ms–1s (queda en 850ms, el punto
// medio del rango pedido).
export const SCAN_RESULT_DURATION_MS = {
    VALID: 850,
    ALREADY_USED: 3500,
    CANCELLED: 3500,
    WRONG_EVENT: 3000,
    NOT_FOUND: 1200,
    // Pseudo-estado, nunca lo devuelve el backend: se sintetiza en el
    // cliente cuando validate() falla por red/timeout durante el escaneo
    // (ver ScanningScreen). Corto, como NOT_FOUND — no hay nada más que
    // leer, sólo hay que volver a intentar con el siguiente QR.
    OFFLINE: 1500,
};

export const SCAN_RESULT_TONE = {
    VALID: "bg-emerald-500 text-white",
    ALREADY_USED: "bg-rose-600 text-white",
    CANCELLED: "bg-rose-600 text-white",
    WRONG_EVENT: "bg-orange-500 text-white",
    NOT_FOUND: "bg-slate-600 text-white",
    OFFLINE: "bg-slate-700 text-white",
};

export const SCAN_RESULT_LABEL = {
    VALID: "Entrada válida",
    ALREADY_USED: "Ya fue utilizada",
    WRONG_EVENT: "No es de esta función",
    CANCELLED: "Entrada cancelada",
    NOT_FOUND: "QR no reconocido",
    OFFLINE: "Sin conexión",
};

// Versión "suave" del mismo tono, para usar en filas de lista (historial)
// en vez del fondo sólido de la pantalla completa de resultado.
export const SCAN_RESULT_BADGE_TONE = {
    VALID: "bg-emerald-500/10 text-emerald-400",
    ALREADY_USED: "bg-rose-500/10 text-rose-400",
    CANCELLED: "bg-rose-500/10 text-rose-400",
    WRONG_EVENT: "bg-orange-500/10 text-orange-400",
    NOT_FOUND: "bg-white/10 text-slate-400",
};
