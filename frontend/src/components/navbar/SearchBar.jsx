import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { SEARCH_SCOPES } from "../../lib/navbarData.js";

// Buscador global del Navbar. Hoy solo navega a /eventos?q=... (EventsList ya
// interpreta ese parámetro contra título/lugar/organización). Queda
// preparado para buscar por múltiples ámbitos (SEARCH_SCOPES: eventos,
// artistas, organizaciones, teatros, ciudades, lugares) el día que exista un
// endpoint de búsqueda real con resultados mixtos; por ahora `scope` no se
// usa para filtrar nada.
export default function SearchBar({ className = "", scope = SEARCH_SCOPES[0].id }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  function handleSubmit(event) {
    event.preventDefault();
    const trimmed = query.trim();
    navigate(trimmed ? `/eventos?q=${encodeURIComponent(trimmed)}` : "/eventos");
  }

  return (
    <form onSubmit={handleSubmit} className={`relative ${className}`} data-search-scope={scope}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar eventos, artistas o lugares..."
        className="h-9 w-full rounded-lg border border-white/10 bg-white/5 pl-9 pr-3 text-sm text-gray-100 outline-none placeholder:text-slate-500 transition-colors duration-150 focus:border-violet-500 focus:bg-white/10 focus:ring-2 focus:ring-violet-500/20"
      />
    </form>
  );
}
