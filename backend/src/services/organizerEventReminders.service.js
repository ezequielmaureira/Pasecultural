import prisma from "../config/prisma.js";
import { logger } from "../logging/logger.js";
import { sendOrganizerNotification, OrganizerNotificationType } from "./email/sendOrganizerNotification.service.js";
import { tryClaimOrganizerNotification } from "./organizerNotificationSettings.service.js";

// Notificaciones Organizer — Eventos (recordatorio antes de una función,
// comienzo, fin). Sin infraestructura de cron/scheduler desplegada en este
// proyecto (auditado de nuevo para esta ronda: sigue sin existir, mismo
// hallazgo que Alertas Developer) — ver runOrganizerEventNotificationsSweep.js
// para el script invocable y cómo programarlo. Esta función es idempotente
// sin importar cuántas veces ni con qué frecuencia se la invoque: cada
// disparo posible se reclama una única vez vía OrganizerNotificationClaim
// (event-reminder:{functionId}:{hoursBefore}, event-start:{functionId},
// event-end:{functionId}), así que correrla de más nunca duplica un email.
//
// STALE_WINDOW_MS — sanity bound: si el sweep estuvo caído varias horas y
// se recupera, NO manda un alud de "comenzó"/"terminó" de funciones viejas
// que ya pasaron hace rato. El recordatorio no necesita este límite: su
// propia condición (`now < fn.date`) ya deja de aplicar sola en cuanto la
// función arranca.
const STALE_WINDOW_MS = 6 * 60 * 60 * 1000;

export async function runOrganizerEventNotificationsSweep() {
    const now = new Date();
    let remindersSent = 0;
    let startsSent = 0;
    let endsSent = 0;

    // Sólo organizaciones que de verdad activaron alguna de las tres —
    // la inmensa mayoría (defaults OFF, ver el informe de entrega) ni
    // siquiera tiene fila, así que este WHERE ya las excluye sin tener que
    // barrer EventFunction de toda la plataforma en cada corrida.
    const settingsRows = await prisma.organizerNotificationSettings.findMany({
        where: { OR: [{ eventReminderEnabled: true }, { eventStartEnabled: true }, { eventEndEnabled: true }] },
        select: {
            organizationId: true,
            eventReminderEnabled: true,
            eventReminderHoursBefore: true,
            eventStartEnabled: true,
            eventEndEnabled: true,
            organization: { select: { email: true } },
        },
    });

    for (const settings of settingsRows) {
        const organizerEmail = settings.organization.email;
        if (!organizerEmail) continue;

        const functions = await prisma.eventFunction.findMany({
            where: { status: { not: "CANCELLED" }, event: { organizationId: settings.organizationId, archivedAt: null } },
            select: { id: true, date: true, endAt: true, venue: true, event: { select: { title: true } } },
        });

        for (const fn of functions) {
            const eventTitle = fn.event.title;

            if (settings.eventReminderEnabled) {
                const triggerAt = new Date(fn.date.getTime() - settings.eventReminderHoursBefore * 60 * 60 * 1000);
                if (now >= triggerAt && now < fn.date) {
                    const claimed = await tryClaimOrganizerNotification(`event-reminder:${fn.id}:${settings.eventReminderHoursBefore}`);
                    if (claimed) {
                        const result = await sendOrganizerNotification(OrganizerNotificationType.EVENT_REMINDER, {
                            to: organizerEmail,
                            eventTitle,
                            venue: fn.venue,
                            functionDate: fn.date,
                            hoursBefore: settings.eventReminderHoursBefore,
                        });
                        if (result.sent) remindersSent += 1;
                        else logger.warn("runOrganizerEventNotificationsSweep: no se pudo enviar el recordatorio", { functionId: fn.id, reason: result.reason });
                    }
                }
            }

            if (settings.eventStartEnabled && now >= fn.date && now.getTime() - fn.date.getTime() < STALE_WINDOW_MS) {
                const claimed = await tryClaimOrganizerNotification(`event-start:${fn.id}`);
                if (claimed) {
                    const result = await sendOrganizerNotification(OrganizerNotificationType.EVENT_STARTED, {
                        to: organizerEmail,
                        eventTitle,
                        venue: fn.venue,
                        functionDate: fn.date,
                    });
                    if (result.sent) startsSent += 1;
                    else logger.warn("runOrganizerEventNotificationsSweep: no se pudo enviar el aviso de comienzo", { functionId: fn.id, reason: result.reason });
                }
            }

            // Fin de función — sólo si EventFunction.endAt tiene valor
            // (ver el informe de entrega, "hora de finalización"): no todo
            // organizador la carga, y no existe ninguna otra fuente
            // autoritativa de cuándo termina una función.
            if (settings.eventEndEnabled && fn.endAt && now >= fn.endAt && now.getTime() - fn.endAt.getTime() < STALE_WINDOW_MS) {
                const claimed = await tryClaimOrganizerNotification(`event-end:${fn.id}`);
                if (claimed) {
                    const result = await sendOrganizerNotification(OrganizerNotificationType.EVENT_ENDED, {
                        to: organizerEmail,
                        eventTitle,
                        venue: fn.venue,
                        functionDate: fn.endAt,
                    });
                    if (result.sent) endsSent += 1;
                    else logger.warn("runOrganizerEventNotificationsSweep: no se pudo enviar el aviso de fin", { functionId: fn.id, reason: result.reason });
                }
            }
        }
    }

    logger.info("runOrganizerEventNotificationsSweep completed", { remindersSent, startsSent, endsSent });
    return { remindersSent, startsSent, endsSent };
}
