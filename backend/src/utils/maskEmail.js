// Enmascara un email ya normalizado para mostrarlo en pantalla sin revelarlo
// completo — ej. "ezequiel@gmail.com" -> "e*******@gmail.com". Nunca se usa
// para decidir nada de negocio, sólo para el mensaje genérico de
// saleRecoveryVerification.service.js (se calcula siempre sobre el email que
// la propia persona tipeó, exista o no una compra real detrás — por eso no
// filtra información).
export function maskEmail(normalizedEmail) {
    const [local, domain] = normalizedEmail.split("@");
    if (!local || !domain) return normalizedEmail;
    const visible = local[0];
    const masked = "*".repeat(Math.max(local.length - 1, 1));
    return `${visible}${masked}@${domain}`;
}
