import { useEffect, useState } from "react";

const MINUTE_MS = 60_000;

function unit(value, singular, plural) {
    return `${value} ${value === 1 ? singular : plural}`;
}

// Muestra sólo la unidad más grande aplicable ("2 días", "4 horas", "15
// minutos") en vez de combinarlas — más fácil de leer de un vistazo, que es
// el objetivo de un contador relativo.
function formatDuration(ms) {
    const totalMinutes = Math.floor(ms / MINUTE_MS);
    const days = Math.floor(totalMinutes / (60 * 24));
    const hours = Math.floor(totalMinutes / 60);

    if (days > 0) return unit(days, "día", "días");
    if (hours > 0) return unit(hours, "hora", "horas");
    if (totalMinutes > 0) return unit(totalMinutes, "minuto", "minutos");
    return "menos de un minuto";
}

// Ticket sólo trae function.date (inicio) — no hay endAt disponible sin
// tocar TicketService, así que no se distingue "en curso" de "finalizó": el
// texto sólo dice si falta o si ya arrancó, nunca miente sobre eso.
export function getEventCountdown(dateValue, now) {
    if (!dateValue) return null;

    const diff = new Date(dateValue).getTime() - now.getTime();

    if (diff > 0) {
        return { phase: "upcoming", label: `Comienza en ${formatDuration(diff)}` };
    }
    return { phase: "started", label: `Comenzó hace ${formatDuration(-diff)}` };
}

// Se actualiza cada minuto (no cada segundo): la granularidad mostrada ya es
// de minutos, así que un tick más frecuente sólo gastaría CPU sin cambiar
// nada visible — importa en una lista con varias entradas montadas juntas.
export function useEventCountdown(dateValue) {
    const [now, setNow] = useState(() => new Date());

    useEffect(() => {
        if (!dateValue) return undefined;
        const id = setInterval(() => setNow(new Date()), MINUTE_MS);
        return () => clearInterval(id);
    }, [dateValue]);

    return getEventCountdown(dateValue, now);
}
