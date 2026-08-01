export function buildTicketNumber(sequence, year = new Date().getFullYear()) {
    return `PC-${year}-${String(sequence).padStart(6, "0")}`;
}
