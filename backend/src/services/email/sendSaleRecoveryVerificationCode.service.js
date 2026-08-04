import { getResendClient, getEmailConfig } from "../../config/resend.js";
import { logger } from "../../logging/logger.js";
import { buildSaleRecoveryVerificationEmail } from "./saleRecoveryVerificationTemplate.js";
import { withTimeout } from "../../utils/withTimeout.js";

const RESEND_CALL_TIMEOUT_MS = 10000; // mismo criterio que los demás envíos por Resend: nunca bloquear la respuesta HTTP indefinidamente

// Envío puro, igual que sendScannerVerificationCodeEmail: no toca la base
// (el compare-and-swap de lastSentAt vive en saleRecoveryVerification.service.js,
// ANTES de llamar acá). Nunca loguea `to` ni el código — sólo si se pudo
// enviar o no, para no dejar rastro del email real de nadie en los logs de
// un flujo pensado justamente para no revelarlo.
export async function sendSaleRecoveryVerificationCodeEmail({ to, code }) {
    const { from, replyTo } = getEmailConfig();
    const { subject, html, text } = buildSaleRecoveryVerificationEmail({ code });

    const resend = getResendClient();
    const result = await withTimeout(
        resend.emails.send({ from, to, replyTo, subject, html, text }),
        RESEND_CALL_TIMEOUT_MS,
        "resend_timeout"
    );

    if (result.error) {
        logger.error("sendSaleRecoveryVerificationCodeEmail: Resend devolvió un error", { errorName: result.error.name });
        throw new Error(result.error.name || "resend_error");
    }

    logger.info("sendSaleRecoveryVerificationCodeEmail: enviado", { providerId: result.data?.id });
    return { providerId: result.data?.id };
}
