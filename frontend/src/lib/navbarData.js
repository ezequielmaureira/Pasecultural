// Datos centralizados del Navbar público. Nada de esto se hardcodea dentro
// de los componentes: Navbar/NavbarDropdown/SearchBar solo consumen estas
// constantes.

// Opciones del dropdown "Explorar eventos". Todas navegan a /eventos con un
// query param preparado; hoy el backend/EventsList solo interpreta
// "categoria", "orden" y "q" (ver EventsList.jsx), así que "cuando" y precio
// quedan preparados para cuando se sume ese filtro, sin romper nada: un
// parámetro no reconocido simplemente se ignora.
export const EXPLORE_EVENTS_OPTIONS = [
  { label: "Todos", to: "/eventos" },
  { label: "Hoy", to: "/eventos?cuando=hoy" },
  { label: "Esta semana", to: "/eventos?cuando=semana" },
  { label: "Este mes", to: "/eventos?cuando=mes" },
  { label: "Próximamente", to: "/eventos?cuando=proximamente" },
  { label: "Gratis", to: "/eventos?precio=gratis" },
  { label: "Más vendidos", to: "/eventos?orden=mas-vendidos" },
  { label: "Últimos publicados", to: "/eventos?orden=recientes" },
];

// Estructura futura de la landing "¿Cómo funciona?" (todavía no desarrollada,
// solo se linkea a /como-funciona con esta lista a modo de adelanto).
export const HOW_IT_WORKS_SECTIONS = [
  { id: "comprar", label: "¿Cómo comprar una entrada?" },
  { id: "qr", label: "¿Cómo recibir el QR?" },
  { id: "ingresar", label: "¿Cómo ingresar al evento?" },
  { id: "faq", label: "Preguntas frecuentes" },
];

// Ámbitos que en el futuro va a poder cubrir el buscador global. El
// componente SearchBar ya queda preparado para recibirlos; la búsqueda real
// (autocompletado por tipo, resultados mixtos) todavía no está implementada.
export const SEARCH_SCOPES = [
  { id: "events", label: "Eventos" },
  { id: "artists", label: "Artistas" },
  { id: "organizations", label: "Organizaciones" },
  { id: "theaters", label: "Teatros" },
  { id: "cities", label: "Ciudades" },
  { id: "venues", label: "Lugares" },
];
