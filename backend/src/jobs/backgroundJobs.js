import { logger } from "../logging/logger.js";
import { tryClaimDeveloperAlertCooldown } from "../services/email/sendDeveloperAlert.service.js";
import { reconcilePendingMercadoPagoSalesService } from "../services/mercadoPagoReconciliation.service.js";
import { retryFailedSaleConfirmationEmailsService } from "../services/email/retryFailedSaleConfirmationEmails.service.js";

// Ronda de preparación para producción — tareas periódicas dentro del mismo
// proceso del backend (no hace falta infraestructura nueva):
//  - reconciliación de pagos de Mercado Pago (webhooks perdidos) y
//    vencimiento de compras abandonadas;
//  - reintento de emails de confirmación FAILED.
//
// DESACTIVADO por default: sólo arranca con BACKGROUND_JOBS_ENABLED=true.
// Activarlo en producción es una decisión explícita (ver el informe de la
// ronda) — nunca se enciende solo con un deploy.
//
// Varias máquinas: cada corrida reclama un "lease" en developer_alert_cooldowns
// (misma tabla y mismo mecanismo atómico que el cooldown de alertas, sin
// migración) — sólo una máquina corre cada tarea por intervalo. Dentro de un
// mismo proceso, una corrida nunca se superpone con la anterior.

export const BACKGROUND_JOBS = [
    { name: "mercadopago-reconciliation", intervalMinutes: 10, run: () => reconcilePendingMercadoPagoSalesService() },
    { name: "sale-confirmation-email-retry", intervalMinutes: 10, run: () => retryFailedSaleConfirmationEmailsService() },
];

export function areBackgroundJobsEnabled(env = process.env) {
    return env.BACKGROUND_JOBS_ENABLED === "true";
}

// Una corrida de una tarea: lease entre máquinas + nunca lanza (un error de
// una tarea no puede tirar abajo el proceso ni frenar las demás).
export async function runJobOnce(job, { claimLease = tryClaimDeveloperAlertCooldown } = {}) {
    if (job.running) return { ran: false, reason: "already_running" };
    job.running = true;
    try {
        // Un poco menos que el intervalo: la próxima corrida programada
        // siempre puede reclamar, aunque el timer se adelante unos segundos.
        const leaseMinutes = Math.max(job.intervalMinutes - 1, 1);
        const claimed = await claimLease(`JOB_LEASE:${job.name}`, leaseMinutes);
        if (!claimed) return { ran: false, reason: "lease_held_elsewhere" };
        const result = await job.run();
        return { ran: true, result };
    } catch (error) {
        logger.error(error, { context: "background job: la corrida falló", job: job.name });
        return { ran: false, reason: "error" };
    } finally {
        job.running = false;
    }
}

export function startBackgroundJobs({ env = process.env, jobs = BACKGROUND_JOBS, setIntervalFn = setInterval } = {}) {
    if (!areBackgroundJobsEnabled(env)) {
        logger.info("background jobs: desactivados (BACKGROUND_JOBS_ENABLED != true)");
        return [];
    }
    const timers = jobs.map((job) => {
        const timer = setIntervalFn(() => {
            runJobOnce(job);
        }, job.intervalMinutes * 60 * 1000);
        timer?.unref?.();
        return timer;
    });
    logger.info("background jobs: activados", { jobs: jobs.map((job) => ({ name: job.name, intervalMinutes: job.intervalMinutes })) });
    return timers;
}
