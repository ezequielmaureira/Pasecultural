import { apiFetch } from "./api.js";

export async function listMyTickets(token) {
    const { tickets } = await apiFetch("/api/tickets/mine", { token });
    return tickets;
}

export async function getTicket(token, ticketId) {
    const { ticket } = await apiFetch(`/api/tickets/${ticketId}`, { token });
    return ticket;
}

export async function getTicketQr(token, ticketId) {
    const { qr } = await apiFetch(`/api/tickets/${ticketId}/qr`, { token });
    return qr;
}
