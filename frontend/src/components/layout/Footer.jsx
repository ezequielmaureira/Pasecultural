import { Link } from "react-router-dom";
import { Ticket } from "lucide-react";

const LEGAL_LINKS = [
  { label: "Términos y condiciones", to: "/" },
  { label: "Privacidad", to: "/" },
];

function InstagramIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} {...props}>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function FacebookIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} {...props}>
      <path d="M15 3h-2a5 5 0 0 0-5 5v3H6v4h2v6h4v-6h3l1-4h-4V8a1 1 0 0 1 1-1h3z" />
    </svg>
  );
}

function TwitterIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} {...props}>
      <path d="M22 5.8c-.7.3-1.5.6-2.3.7a4 4 0 0 0 1.8-2.2 8 8 0 0 1-2.5 1 4 4 0 0 0-6.9 3.6A11.4 11.4 0 0 1 3.9 4.6a4 4 0 0 0 1.2 5.3 4 4 0 0 1-1.8-.5v.1a4 4 0 0 0 3.2 3.9 4 4 0 0 1-1.8.1 4 4 0 0 0 3.7 2.8A8 8 0 0 1 2 17.9a11.3 11.3 0 0 0 6.1 1.8c7.3 0 11.3-6.1 11.3-11.3v-.5A8 8 0 0 0 22 5.8z" />
    </svg>
  );
}

const SOCIAL_LINKS = [
  { label: "Instagram", icon: InstagramIcon, href: "#" },
  { label: "Facebook", icon: FacebookIcon, href: "#" },
  { label: "Twitter", icon: TwitterIcon, href: "#" },
];

export default function Footer() {
  return (
    <footer className="border-t border-white/5 light:border-slate-200">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <Link to="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-blue-500 text-white">
            <Ticket className="h-4 w-4" />
          </div>
          <span className="text-sm font-bold text-white light:text-slate-900">
            Pase<span className="text-violet-400">Cultural</span>
          </span>
        </Link>

        <p className="text-xs text-slate-500">
          © 2026 PaseCultural. Todos los derechos reservados.
        </p>

        <div className="flex items-center gap-5">
          {LEGAL_LINKS.map((link) => (
            <Link
              key={link.label}
              to={link.to}
              className="text-xs text-slate-400 transition-colors duration-150 hover:text-white light:text-slate-500 light:hover:text-slate-900"
            >
              {link.label}
            </Link>
          ))}
          <div className="flex items-center gap-3">
            {SOCIAL_LINKS.map(({ label, icon: Icon, href }) => (
              <a
                key={label}
                href={href}
                aria-label={label}
                className="text-slate-500 transition-colors duration-150 hover:text-white light:hover:text-slate-900"
              >
                <Icon className="h-4 w-4" />
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
