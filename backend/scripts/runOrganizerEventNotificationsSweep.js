// Punto de entrada pensado para un futuro job/scheduler externo — todavía
// no desplegado (ver informe de entrega, sección "Cron/scheduler"). Cuando
// se decida activarlo: comando
// `node scripts/runOrganizerEventNotificationsSweep.js`, frecuencia
// sugerida cada 15 minutos (ej. "*/15 * * * *") — el propio mecanismo de
// deduplicación (OrganizerNotificationClaim) hace que correrlo más o menos
// seguido nunca duplique un email, así que la frecuencia sólo afecta qué
// tan preciso es el recordatorio/aviso de comienzo/fin, nunca la seguridad
// de no repetir. Necesita las mismas env vars que el servicio web
// (DATABASE_URL, RESEND_API_KEY, EMAIL_FROM, FRONTEND_URL) configuradas en
// el propio scheduler que se elija, no heredadas automáticamente del
// proceso web.
import "dotenv/config";
import { runOrganizerEventNotificationsSweep } from "../src/services/organizerEventReminders.service.js";

async function main() {
    const result = await runOrganizerEventNotificationsSweep();
    console.log("runOrganizerEventNotificationsSweep: completado", result);
}

main()
    .catch((err) => {
        console.error("runOrganizerEventNotificationsSweep: error inesperado", err);
        process.exitCode = 1;
    })
    .finally(() => process.exit());
