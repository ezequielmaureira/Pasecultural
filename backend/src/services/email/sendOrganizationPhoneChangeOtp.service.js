import { getResendClient, getEmailConfig } from "../../config/resend.js";
import { logger } from "../../logging/logger.js";
import { buildOrganizationPhoneChangeOtpEmail } from "./organizationPhoneChangeOtpTemplate.js";
import { withTimeout } from "../../utils/withTimeout.js";

const RESEND_CALL_TIMEOUT_MS = 10000; // mismo criterio que el resto de envíos por Resend

// Envío puro, mismo criterio que sendWithdrawalRequestOtpEmail: no toca la
// base (el compare-and-swap de lastSentAt vive en
// organizationPhoneVerification.service.js, ANTES de llamar acá). Nunca
// loguea `to`, el código, ni el teléfono nuevo.
export async function sendOrganizationPhoneChangeOtpEmail({ to, code, organizationName }) {
    const { from, replyTo } = getEmailConfig();
    const { subject, html, text } = buildOrganizationPhoneChangeOtpEmail({ code, organizationName });

    const resend = getResendClient();
    const result = await withTimeout(resend.emails.send({ from, to, replyTo, subject, html, text }), RESEND_CALL_TIMEOUT_MS, "resend_timeout");

    if (result.error) {
        logger.error("sendOrganizationPhoneChangeOtpEmail: Resend devolvió un error", { errorName: result.error.name });
        throw new Error(result.error.name || "resend_error");
    }

    logger.info("sendOrganizationPhoneChangeOtpEmail: enviado", { providerId: result.data?.id });
    return { providerId: result.data?.id };
}
