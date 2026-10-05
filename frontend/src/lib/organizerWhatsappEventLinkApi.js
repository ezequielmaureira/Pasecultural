import { apiFetch } from "./api.js";

// "Crear con WhatsApp" (Sidebar.jsx, bajo Eventos) — la URL wa.me SIEMPRE
// se pide al backend, nunca se arma acá: el número oficial
// (WHATSAPP_DISPLAY_PHONE_NUMBER) es configuración de servidor, mismo
// criterio que organizationPhoneVerificationApi.js#getOrganizationPhoneStatus.
export async function getWhatsappEventCreationLink(token) {
  return apiFetch("/api/organizations/me/whatsapp-event-link", { token });
}
