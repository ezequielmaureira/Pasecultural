// Extraído de sendScannerVerificationCode.service.js / sendSaleConfirmationEmail.service.js
// (misma función, duplicada en ambos) — nunca bloquear la respuesta HTTP
// indefinidamente por un envío de Resend colgado.
export function withTimeout(promise, ms, timeoutReason) {
    let timeoutId;
    const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(timeoutReason)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}
