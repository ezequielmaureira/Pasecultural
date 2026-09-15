// Punto de entrada pensado para un futuro job/scheduler externo — todavía
// no desplegado (ver informe de entrega, sección "Resumen diario"). Cuando
// se decida activarlo: comando `node scripts/sendDeveloperDailyDigest.js`,
// horario sugerido una vez por día (ej. "0 9 * * *" — 9am UTC). Necesita
// las mismas env vars que el servicio web (DATABASE_URL, RESEND_API_KEY,
// EMAIL_FROM, DEVELOPER_ALERT_EMAIL) configuradas en el propio scheduler
// que se elija, no heredadas automáticamente del proceso web.
import "dotenv/config";
import { generateAndSendDeveloperDailyDigest } from "../src/services/developerAlertDigest.service.js";

async function main() {
    const result = await generateAndSendDeveloperDailyDigest();
    if (!result.sent) {
        console.error("sendDeveloperDailyDigest: no se pudo enviar", result.reason);
        process.exitCode = 1;
        return;
    }
    console.log("sendDeveloperDailyDigest: enviado", result.stats);
}

main()
    .catch((err) => {
        console.error("sendDeveloperDailyDigest: error inesperado", err);
        process.exitCode = 1;
    })
    .finally(() => process.exit());
