import { getResendClient, getEmailConfig } from "../../config/resend.js";
import { logger } from "../../logging/logger.js";
import { buildWithdrawalRequestOtpEmail } from "./withdrawalRequestOtpTemplate.js";
import { withTimeout } from "../../utils/withTimeout.js";

const RESEND_CALL_TIMEOUT_MS = 10000; // mismo criterio que el resto de envíos por Resend

// Envío puro, igual que sendSaleRecoveryVerificationCodeEmail: no toca la
// base (el compare-and-swap de lastSentAt vive en
// withdrawalRequestVerification.service.js, ANTES de llamar acá). Nunca
// loguea `to` ni el código.
export async function sendWithdrawalRequestOtpEmail({ to, code }) {
    const { from, replyTo } = getEmailConfig();
    const { subject, html, text } = buildWithdrawalRequestOtpEmail({ code });

    const resend = getResendClient();
    const result = await withTimeout(resend.emails.send({ from, to, replyTo, subject, html, text }), RESEND_CALL_TIMEOUT_MS, "resend_timeout");

    if (result.error) {
        logger.error("sendWithdrawalRequestOtpEmail: Resend devolvió un error", { errorName: result.error.name });
        throw new Error(result.error.name || "resend_error");
    }

    logger.info("sendWithdrawalRequestOtpEmail: enviado", { providerId: result.data?.id });
    return { providerId: result.data?.id };
}
