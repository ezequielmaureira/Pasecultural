// Punto de entrada pensado para un futuro Render Cron Job — NO desplegado
// en esta ronda (ver informe de entrega, sección "Resumen diario"). Cuando
// se decida activarlo: Render Dashboard > New > Cron Job, mismo repo/build
// que el Web Service, comando `node scripts/sendDeveloperDailyDigest.js`,
// horario sugerido una vez por día (ej. "0 9 * * *" — 9am UTC). Necesita
// las mismas env vars que el Web Service (DATABASE_URL, RESEND_API_KEY,
// EMAIL_FROM, DEVELOPER_ALERT_EMAIL) configuradas en el propio Cron Job de
// Render, no heredadas automáticamente del Web Service.
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
