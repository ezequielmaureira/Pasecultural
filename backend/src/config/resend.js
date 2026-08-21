import { Resend } from "resend";

// Cliente + configuración centralizada de Resend. Igual que
// qrEncryption.js#getKey, la validación es LAZY (recién al primer envío
// real), no al importar este módulo: si validara al importar, arrancar el
// servidor sin RESEND_API_KEY tiraría abajo TODA la app (login, eventos,
// organizaciones) en vez de sólo fallar el envío de email puntual que de
// verdad la necesita.
let cachedClient;

// Nunca loguea valores — sólo nombres de variables faltantes. RESEND_API_KEY
// es un secreto; EMAIL_FROM/FRONTEND_URL no lo son, pero tampoco hace falta
// volcarlos a los logs para saber que faltan.
function getRequiredEnv(name) {
    const value = process.env[name];
    if (!value || !value.trim()) {
        throw new Error(`Falta configurar la variable de entorno ${name}.`);
    }
    return value.trim();
}

export function getResendClient() {
    if (cachedClient) return cachedClient;
    cachedClient = new Resend(getRequiredEnv("RESEND_API_KEY"));
    return cachedClient;
}

// EMAIL_REPLY_TO es opcional a propósito (no todo deploy necesita una
// casilla de soporte distinta al remitente); el resto son obligatorios para
// poder mandar un email coherente y con el link de recuperación correcto.
export function getEmailConfig() {
    return {
        from: getRequiredEnv("EMAIL_FROM"),
        replyTo: process.env.EMAIL_REPLY_TO?.trim() || undefined,
        frontendUrl: getRequiredEnv("FRONTEND_URL").replace(/\/+$/, ""),
    };
}

// Casilla interna que recibe la alerta de "Mercado Pago aprobó un pago que
// PaseCultural no pudo cumplir por falta de stock" (ver
// mercadoPagoWebhook.service.js y sendMercadoPagoReconciliationAlert.service.js).
// Mismo criterio LAZY que el resto de este archivo — sólo se exige al
// momento de mandar esa alerta puntual, nunca al arrancar el servidor.
export function getReconciliationAlertEmail() {
    return getRequiredEnv("MERCADOPAGO_RECONCILIATION_ALERT_EMAIL");
}

// Casilla interna de las Alertas Developer (riesgo de plataforma,
// comportamiento excepcional, integraciones — ver
// sendDeveloperAlert.service.js). A propósito una variable de entorno
// DISTINTA de MERCADOPAGO_RECONCILIATION_ALERT_EMAIL: son responsabilidades
// diferentes (conciliación financiera puntual vs. radar Developer general)
// y pueden terminar teniendo destinatarios distintos. Mismo criterio LAZY:
// si DEVELOPER_ALERT_EMAIL no está configurada, la app arranca igual y
// cualquier operación principal sigue funcionando — sólo falla, de forma
// best-effort, el envío puntual de la alerta (ver sendDeveloperAlert).
export function getDeveloperAlertEmail() {
    return getRequiredEnv("DEVELOPER_ALERT_EMAIL");
}
