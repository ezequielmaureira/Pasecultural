import { getResendClient, getEmailConfig } from "../../config/resend.js";
import { logger } from "../../logging/logger.js";
import { buildScannerVerificationEmail } from "./scannerVerificationTemplate.js";
import { withTimeout } from "../../utils/withTimeout.js";

const RESEND_CALL_TIMEOUT_MS = 10000; // mismo criterio que sendSaleConfirmationEmail: nunca bloquear la respuesta HTTP indefinidamente por Resend

// Envío puro: no toca la base (el compare-and-swap de verificationLastSentAt
// que lo protege contra duplicados/spam vive en scannerInvitation.service.js,
// ANTES de llamar acá — este service sólo sabe mandar el email). Nunca
// loguea el código: sólo el eventScannerId y si se pudo enviar o no.
export async function sendScannerVerificationCodeEmail({ eventScannerId, to, firstName, eventTitle, gate, code }) {
    const { from, replyTo } = getEmailConfig();
    const { subject, html, text } = buildScannerVerificationEmail({ firstName, eventTitle, gate, code });

    const resend = getResendClient();
    const result = await withTimeout(
        resend.emails.send({ from, to, replyTo, subject, html, text }),
        RESEND_CALL_TIMEOUT_MS,
        "resend_timeout"
    );

    if (result.error) {
        logger.error("sendScannerVerificationCodeEmail: Resend devolvió un error", { eventScannerId, errorName: result.error.name });
        throw new Error(result.error.name || "resend_error");
    }

    logger.info("sendScannerVerificationCodeEmail: enviado", { eventScannerId, providerId: result.data?.id });
    return { providerId: result.data?.id };
}
