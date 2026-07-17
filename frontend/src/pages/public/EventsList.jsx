import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Search } from "lucide-react";
import { apiFetch } from "../../lib/api.js";
import CategoryFilterBar from "../../components/marketplace/CategoryFilterBar.jsx";
import EventCard from "../../components/marketplace/EventCard.jsx";

const SORT_OPTIONS = [
  { id: "recientes", label: "Más recientes" },
  { id: "fecha", label: "Fecha" },
  { id: "precio", label: "Precio" },
];

const WHEN_LABEL = {
  hoy: "Eventos de hoy",
  semana: "Eventos de esta semana",
  mes: "Eventos de este mes",
  proximamente: "Próximamente",
};

export default function EventsList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const category = searchParams.get("categoria") || "ALL";
  const sort = searchParams.get("orden") || "recientes";
  const [search, setSearch] = useState(searchParams.get("q") || "");
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (category !== "ALL") params.set("category", category);
    if (sort !== "recientes") params.set("sort", sort);
    if (searchParams.get("q")) params.set("search", searchParams.get("q"));
    if (searchParams.get("cuando")) params.set("when", searchParams.get("cuando"));
    if (searchParams.get("precio")) params.set("price", searchParams.get("precio"));
    return params.toString();
  }, [category, sort, searchParams]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    const path = query ? `/api/events/public?${query}` : "/api/events/public";
    apiFetch(path)
      .then(({ events: list }) => {
        if (!cancelled) setEvents(list);
      })
      .catch((err) => {
        console.error("No se pudieron cargar los eventos", err);
        if (!cancelled) setError("No pudimos cargar los eventos. Probá de nuevo.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [query]);

  function updateParam(key, value) {
    const next = new URLSearchParams(searchParams);
    if (value && value !== "ALL" && value !== "recientes") {
      next.set(key, value);
    } else {
      next.delete(key);
    }
    setSearchParams(next);
  }

  function handleSearchSubmit(event) {
    event.preventDefault();
    updateParam("q", search.trim());
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-10">
      <div>
        <h1 className="text-2xl font-bold text-white">Eventos</h1>
        <p className="text-sm text-slate-400">
          {WHEN_LABEL[searchParams.get("cuando")] ??
            "Explorá los eventos publicados por nuestros organizadores"}
        </p>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <form onSubmit={handleSearchSubmit} className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por título, lugar u organización"
            className="h-10 w-full rounded-lg border border-white/10 bg-white/5 pl-9 pr-3 text-sm text-gray-100 outline-none placeholder:text-slate-500 focus:border-violet-500 focus:bg-white/10 focus:ring-2 focus:ring-violet-500/20"
          />
        </form>

        <select
          value={sort}
          onChange={(e) => updateParam("orden", e.target.value)}
          className="h-10 shrink-0 rounded-lg border border-white/10 bg-white/5 px-3 text-sm font-medium text-gray-100 outline-none transition-colors duration-150 hover:bg-white/10 focus:border-violet-500"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.id} value={opt.id} className="bg-[#0B1120]">
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <CategoryFilterBar
        value={category}
        onChange={(id) => updateParam("categoria", id)}
      />

      {loading && (
        <p className="py-10 text-center text-sm text-slate-500">Cargando eventos...</p>
      )}

      {!loading && error && (
        <p className="py-10 text-center text-sm text-rose-400">{error}</p>
      )}

      {!loading && !error && events.length === 0 && (
        <p className="py-10 text-center text-sm text-slate-500">
          No encontramos eventos con esos filtros.
        </p>
      )}

      {!loading && !error && events.length > 0 && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {events.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}
