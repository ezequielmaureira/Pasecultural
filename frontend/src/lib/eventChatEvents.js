// Nombre del evento de window que dispara el link "Crear evento" del
// sidebar cuando el usuario ya está parado en /organizador/eventos/nuevo:
// un <Link>/<NavLink> al mismo pathname no navega ni remonta nada, así que
// esta es la forma de avisarle a ConversationView.jsx (que vive en un
// subárbol distinto del sidebar) que se pidió empezar un evento nuevo, sin
// acoplar el layout al estado interno de la conversación.
export const NEW_EVENT_REQUEST_EVENT = "pasecultural:new-event-requested";
