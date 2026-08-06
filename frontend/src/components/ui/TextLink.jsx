import { Link } from "react-router-dom";

// Link de texto secundario (ej. "Ver todos") con foco visible — evita
// repetir las mismas clases de hover/focus en cada acción de SectionHeader.
export default function TextLink({ to, children, className = "" }) {
  return (
    <Link
      to={to}
      className={`rounded text-xs font-medium text-violet-400 transition-colors hover:text-violet-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#05070B] ${className}`}
    >
      {children}
    </Link>
  );
}
