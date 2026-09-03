import { Link } from "react-router-dom";
import { Building2 } from "lucide-react";

// Card de organización para el shelf de "Organizaciones destacadas" (Home)
// y la grilla de /organizaciones. Mismo criterio visual que EventCard.jsx
// (mismos tokens de color/borde/hover, variantes `light:` para el modo
// claro). El score/ranking NUNCA se muestra acá — sólo nombre/logo/ciudad.
export default function OrganizationCard({ organization }) {
  return (
    <Link
      to={`/organizacion/${organization.slug}`}
      className="group flex flex-col items-center gap-2 overflow-hidden rounded-xl border border-white/10 bg-[#0B1120] p-4 text-center transition-colors duration-150 hover:border-violet-500/40 light:border-slate-200 light:bg-white"
    >
      <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/5 light:bg-slate-100">
        {organization.logo ? (
          <img
            src={organization.logo}
            alt={organization.name}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <Building2 className="h-8 w-8 text-slate-600" />
        )}
      </div>
      <p className="line-clamp-2 text-sm font-semibold text-white light:text-slate-900">
        {organization.name}
      </p>
      {(organization.city || organization.province) && (
        <p className="truncate text-xs text-slate-400 light:text-slate-500">
          {[organization.city, organization.province].filter(Boolean).join(", ")}
        </p>
      )}
    </Link>
  );
}
