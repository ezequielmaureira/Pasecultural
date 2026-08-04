// Única fuente de verdad de cómo se ve/cuánto dura cada resultado de
// escaneo. VALID/ALREADY_USED en ~2s (pedido explícito: "mantener el
// resultado aproximadamente 2 segundos" para ambos). NOT_FOUND se mantiene
// corto a propósito: en la práctica es el resultado más frecuente de un mal
// encuadre o un QR de otra app — alargarlo entrena al operador a esperar en
// el caso que menos información nueva aporta.
export const SCAN_RESULT_DURATION_MS = {
    VALID: 2000,
    ALREADY_USED: 2000,
    CANCELLED: 2000,
    WRONG_EVENT: 2500,
    NOT_FOUND: 1200,
    // Pseudo-estado, nunca lo devuelve el backend: se sintetiza en el
    // cliente cuando no hay conexión o validate() falla por red/timeout
    // durante el escaneo (ver ScanningScreen).
    OFFLINE: 1500,
};

export const SCAN_RESULT_TONE = {
    VALID: "bg-emerald-500 text-white",
    ALREADY_USED: "bg-rose-600 text-white",
    CANCELLED: "bg-rose-600 text-white",
    WRONG_EVENT: "bg-orange-500 text-white",
    NOT_FOUND: "bg-rose-600 text-white",
    OFFLINE: "bg-slate-700 text-white",
};

export const SCAN_RESULT_LABEL = {
    VALID: "Acceso permitido",
    ALREADY_USED: "Entrada ya utilizada",
    WRONG_EVENT: "Esta entrada pertenece a otro evento",
    CANCELLED: "Entrada cancelada",
    NOT_FOUND: "QR inválido",
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
