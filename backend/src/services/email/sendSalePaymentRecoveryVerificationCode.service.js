import { getResendClient, getEmailConfig } from "../../config/resend.js";
import { logger } from "../../logging/logger.js";
import { buildSalePaymentRecoveryVerificationEmail } from "./salePaymentRecoveryVerificationTemplate.js";
import { withTimeout } from "../../utils/withTimeout.js";

const RESEND_CALL_TIMEOUT_MS = 10000; // mismo criterio que el resto de services/email

// Envío puro, igual que sendSaleRecoveryVerificationCode.service.js (que
// este archivo deliberadamente no reusa — ver el comentario del template):
// no toca la base, nunca loguea `to` ni el código.
export async function sendSalePaymentRecoveryVerificationCodeEmail({ to, code }) {
    const { from, replyTo } = getEmailConfig();
    const { subject, html, text } = buildSalePaymentRecoveryVerificationEmail({ code });

    const resend = getResendClient();
    const result = await withTimeout(
        resend.emails.send({ from, to, replyTo, subject, html, text }),
        RESEND_CALL_TIMEOUT_MS,
        "resend_timeout"
    );

    if (result.error) {
        logger.error("sendSalePaymentRecoveryVerificationCodeEmail: Resend devolvió un error", { errorName: result.error.name });
        throw new Error(result.error.name || "resend_error");
    }

    logger.info("sendSalePaymentRecoveryVerificationCodeEmail: enviado", { providerId: result.data?.id });
    return { providerId: result.data?.id };
}
