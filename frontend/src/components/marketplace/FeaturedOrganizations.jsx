import { Link } from "react-router-dom";
import HorizontalScroller from "./HorizontalScroller.jsx";

// Mismo fallback visual que ya usa Sidebar.jsx para el logo de Organization
// (gradiente violeta→azul + inicial del nombre) — reutilizado acá para no
// inventar un segundo patrón de "avatar sin logo" en el repo.
function OrganizationAvatar({ name, logo }) {
  if (logo) {
    return (
      <img
        src={logo}
        alt={name}
        className="h-16 w-16 shrink-0 rounded-full object-cover sm:h-20 sm:w-20"
      />
    );
  }
  return (
    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-blue-500 text-lg font-extrabold text-white sm:h-20 sm:w-20 sm:text-xl">
      {name?.[0]?.toUpperCase() ?? "O"}
    </div>
  );
}

// Acceso rápido a espacios de Organization Premium — nunca una tabla, nunca
// datos administrativos (plan/IDs/emails). La elegibilidad Premium ya vino
// resuelta del backend (GET /api/organizations/public/featured); acá sólo
// se renderiza lo que llegó, sin ningún chequeo de plan en frontend.
export default function FeaturedOrganizations({ organizations }) {
  if (organizations.length === 0) return null;

  return (
    <HorizontalScroller>
      {organizations.map((org) => (
        <Link
          key={org.id}
          to={`/organizacion/${org.slug}`}
          className="flex w-24 shrink-0 snap-start flex-col items-center gap-2 rounded-xl p-2 text-center transition-colors duration-150 hover:bg-white/5 sm:w-28"
        >
          <OrganizationAvatar name={org.name} logo={org.logo} />
          <span className="line-clamp-2 text-xs font-medium text-slate-200 sm:text-sm">
            {org.name}
          </span>
        </Link>
      ))}
    </HorizontalScroller>
  );
}
