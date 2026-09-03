import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Search } from "lucide-react";
import { apiFetch } from "../../lib/api.js";
import OrganizationCard from "../../components/marketplace/OrganizationCard.jsx";

// Debounce chico, sin dependencias — search es server-side (ver
// organizationRanking.service.js#getPublicOrganizationsListService), así
// que cada tecleo no puede disparar un fetch directo.
const SEARCH_DEBOUNCE_MS = 350;

// Filtro por rubro — Organization.organizationCategory (ver
// organizationRanking.service.js#getPublicOrganizationsListService).
// "UNCATEGORIZED" es el sentinela server-side para "sin rubro cargado"
// (organizationCategory NULL) — nunca se excluyen del listado general, sólo
// se filtran puntualmente al elegir esta opción.
const CATEGORY_OPTIONS = [
  { id: "", label: "Todos los rubros" },
  { id: "THEATER", label: "Teatro" },
  { id: "CINEMA", label: "Cine" },
  { id: "MUSIC", label: "Música" },
  { id: "SPORTS", label: "Deportes" },
  { id: "CULTURE", label: "Cultura" },
  { id: "PRODUCER", label: "Productora" },
  { id: "OTHER", label: "Otro" },
  { id: "UNCATEGORIZED", label: "Sin categoría" },
];

export default function OrganizationsList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchInput, setSearchInput] = useState(searchParams.get("search") || "");
  const [organizations, setOrganizations] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const search = searchParams.get("search") || "";
  const category = searchParams.get("category") || "";
  const page = Number(searchParams.get("page") || "1");

  // Debounce: el input local se refleja al searchParam recién después de
  // SEARCH_DEBOUNCE_MS sin tipeo, y vuelve siempre a la página 1.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput.trim() !== search) {
        const next = new URLSearchParams(searchParams);
        if (searchInput.trim()) next.set("search", searchInput.trim());
        else next.delete("search");
        next.delete("page");
        setSearchParams(next);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (category) params.set("category", category);
    params.set("page", String(page));
    params.set("limit", "20");

    apiFetch(`/api/organizations/public?${params.toString()}`)
      .then(({ organizations: list, pagination: p }) => {
        if (cancelled) return;
        setOrganizations(list);
        setPagination(p);
      })
      .catch((err) => {
        console.error("No se pudieron cargar las organizaciones", err);
        if (!cancelled) setError("No pudimos cargar las organizaciones. Probá de nuevo.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [search, category, page]);

  function goToPage(nextPage) {
    const next = new URLSearchParams(searchParams);
    next.set("page", String(nextPage));
    setSearchParams(next);
  }

  return (
    <div className="mx-auto flex min-w-0 max-w-7xl flex-col gap-6 px-4 py-10 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Organizaciones</h1>
        <p className="text-sm text-slate-400">Explorá las organizaciones que publican en Smarticket</p>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Buscar por nombre"
            className="h-10 w-full rounded-lg border border-white/10 bg-white/5 pl-9 pr-3 text-sm text-gray-100 outline-none placeholder:text-slate-500 focus:border-violet-500 focus:bg-white/10 focus:ring-2 focus:ring-violet-500/20"
          />
        </div>

        <select
          value={category}
          onChange={(e) => {
            const next = new URLSearchParams(searchParams);
            if (e.target.value) next.set("category", e.target.value);
            else next.delete("category");
            next.delete("page");
            setSearchParams(next);
          }}
          className="h-10 shrink-0 rounded-lg border border-white/10 bg-white/5 px-3 text-sm font-medium text-gray-100 outline-none transition-colors duration-150 hover:bg-white/10 focus:border-violet-500"
        >
          {CATEGORY_OPTIONS.map((opt) => (
            <option key={opt.id} value={opt.id} className="bg-[#0B1120]">
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {loading && (
        <p className="py-10 text-center text-sm text-slate-500">Cargando organizaciones...</p>
      )}

      {!loading && error && (
        <p className="py-10 text-center text-sm text-rose-400">{error}</p>
      )}

      {!loading && !error && organizations.length === 0 && (
        <p className="py-10 text-center text-sm text-slate-500">
          No encontramos organizaciones con esos filtros.
        </p>
      )}

      {!loading && !error && organizations.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {organizations.map((org) => (
              <OrganizationCard key={org.id} organization={org} />
            ))}
          </div>

          {pagination.totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => goToPage(page - 1)}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-medium text-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Anterior
              </button>
              <span className="text-sm text-slate-400">
                Página {pagination.page} de {pagination.totalPages}
              </span>
              <button
                type="button"
                disabled={page >= pagination.totalPages}
                onClick={() => goToPage(page + 1)}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-medium text-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Siguiente
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
