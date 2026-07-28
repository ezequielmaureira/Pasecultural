import { apiFetch } from "./api.js";

// Wrapper fino sobre el Event Creation Engine: no agrega lógica de negocio
// ni validación propia, sólo tipa las tres llamadas que expone el backend
// (backend/src/routes/conversation.routes.js). El frontend nunca decide el
// siguiente paso: siempre re-renderiza el `prompt` que devuelve cada llamada.
export function startConversation(token) {
  return apiFetch("/api/conversations/start", { token, method: "POST" });
}

export function replyConversation(token, conversationId, body) {
  return apiFetch(`/api/conversations/${conversationId}/reply`, {
    token,
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getConversation(token, conversationId) {
  return apiFetch(`/api/conversations/${conversationId}`, { token });
}

export function cancelConversation(token, conversationId) {
  return apiFetch(`/api/conversations/${conversationId}`, { token, method: "DELETE" });
}
