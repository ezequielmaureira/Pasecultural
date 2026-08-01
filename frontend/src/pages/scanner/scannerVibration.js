// Vibration API sólo si el navegador la soporta — degrada en silencio si
// no existe o si el navegador la rechaza (iOS Safari no la soporta en
// absoluto; nunca debe verse como un error).
export function vibrateForResult(status) {
    if (!("vibrate" in navigator)) return;
    try {
        if (status === "VALID") {
            navigator.vibrate(80);
        } else if (status === "ALREADY_USED" || status === "CANCELLED") {
            navigator.vibrate([120, 80, 120]);
        } else if (status === "WRONG_EVENT") {
            navigator.vibrate(120);
        }
    } catch {
        // Nunca debe romper el flujo de escaneo por esto.
    }
}
