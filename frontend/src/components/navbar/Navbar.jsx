import { useEffect, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { Ticket, ShoppingCart, LayoutDashboard, Menu, X, ChevronDown } from "lucide-react";
import Button from "../ui/Button.jsx";
import NavbarDropdown from "./NavbarDropdown.jsx";
import SearchBar from "./SearchBar.jsx";
import UserMenu from "./UserMenu.jsx";
import { NAVBAR_CATEGORIES } from "../../lib/eventCategories.js";
import { EXPLORE_EVENTS_OPTIONS } from "../../lib/navbarData.js";
import { useBackendUser } from "../../context/AuthContext.jsx";

const CATEGORY_ITEMS = NAVBAR_CATEGORIES.map((c) => ({
  label: c.label,
  emoji: c.emoji,
  to: `/eventos?categoria=${c.id}`,
}));

const navLinkClassName = ({ isActive }) =>
  `relative py-1 text-sm font-medium transition-colors duration-150 ${
    isActive
      ? "text-violet-400 after:absolute after:-bottom-[21px] after:left-0 after:h-0.5 after:w-full after:bg-violet-500"
      : "text-slate-300 hover:text-white light:text-slate-600 light:hover:text-slate-900"
  }`;

export default function Navbar() {
  const { backendUser } = useBackendUser();
  const isOrganizer = backendUser?.role?.toLowerCase() === "organizer";
  const isDeveloper = backendUser?.role?.toLowerCase() === "developer";
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    function handleScroll() {
      setScrolled(window.scrollY > 8);
    }
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [isOrganizer]);

  // El menú de usuario/dropdowns internos ya cierran con Escape por su
  // cuenta (ver NavbarDropdown) — esto es específicamente para el panel del
  // hamburguesa, que es un simple booleano propio del Navbar.
  useEffect(() => {
    if (!mobileOpen) return undefined;
    function handleKeyDown(event) {
      if (event.key === "Escape") setMobileOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mobileOpen]);

  return (
    <header
      className={`sticky top-0 z-20 border-b transition-all duration-300 light:border-slate-200 light:bg-white/95 ${
        scrolled
          ? "border-white/10 bg-[#05070B]/90 shadow-lg shadow-black/40 backdrop-blur-xl light:shadow-slate-200/60"
          : "border-white/5 bg-[#05070B]/95 backdrop-blur"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-3 sm:px-6 lg:px-8">
        <Link to="/" className="flex shrink-0 items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-blue-500 text-white">
            <Ticket className="h-5 w-5" />
          </div>
          <div className="leading-tight">
            <span className="block text-lg font-bold text-white light:text-slate-900">
              Pase<span className="text-violet-400">Cultural</span>
            </span>
            <span className="hidden text-[11px] italic text-slate-500 sm:block light:text-slate-400">
              Descubrí, organizá y viví eventos.
            </span>
          </div>
        </Link>

        <nav aria-label="Navegación principal" className="hidden items-center gap-6 lg:flex">
          <NavbarDropdown label="Explorar eventos" items={EXPLORE_EVENTS_OPTIONS} />
          <NavbarDropdown label="Categorías" items={CATEGORY_ITEMS} />
          <NavLink to="/como-funciona" className={navLinkClassName}>
            ¿Cómo funciona?
          </NavLink>
          <NavLink
            to={isOrganizer ? "/organizador" : "/para-organizadores"}
            className={navLinkClassName}
          >
            Para organizadores
          </NavLink>
          <NavLink to="/recuperar-compra" className={navLinkClassName}>
            Recuperar mis entradas
          </NavLink>
          <NavLink to="/arrepentimiento" className={navLinkClassName}>
            Botón de arrepentimiento
          </NavLink>
        </nav>

        <SearchBar className="ml-2 hidden max-w-xs flex-1 md:block" />

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            aria-label="Carrito"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-300 transition-colors duration-150 hover:bg-white/5 hover:text-white light:text-slate-500 light:hover:bg-slate-900/5 light:hover:text-slate-900"
          >
            <ShoppingCart className="h-[18px] w-[18px]" />
          </button>
          {isDeveloper && (
            <Link to="/developer">
              <Button size="sm" className="ml-2 hidden items-center gap-1.5 sm:flex">
                <LayoutDashboard className="h-4 w-4" />
                Panel developer
              </Button>
            </Link>
          )}
          <UserMenu />
          <button
            type="button"
            aria-label={mobileOpen ? "Cerrar menú" : "Abrir menú"}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav-menu"
            onClick={() => setMobileOpen((open) => !open)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-300 transition-colors duration-150 hover:bg-white/5 hover:text-white light:text-slate-500 light:hover:bg-slate-900/5 light:hover:text-slate-900 lg:hidden"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div id="mobile-nav-menu" className="border-t border-white/5 bg-[#05070B] px-4 py-4 light:border-slate-200 light:bg-white sm:px-6 lg:hidden">
          <SearchBar className="mb-4 w-full md:hidden" />
          <nav aria-label="Navegación" className="flex flex-col gap-1">
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium text-slate-200 transition-colors duration-150 hover:bg-white/5 hover:text-white light:text-slate-700 light:hover:bg-slate-900/5 light:hover:text-slate-900 [&::-webkit-details-marker]:hidden">
                Explorar eventos
                <ChevronDown className="h-4 w-4 shrink-0 text-slate-500 transition-transform duration-200 group-open:rotate-180" />
              </summary>
              <div className="flex flex-col gap-1 py-1 pl-3">
                {EXPLORE_EVENTS_OPTIONS.map((option) => (
                  <NavLink
                    key={option.label}
                    to={option.to}
                    onClick={() => setMobileOpen(false)}
                    className="rounded-lg px-3 py-2 text-sm text-slate-400 transition-colors duration-150 hover:bg-white/5 hover:text-white light:text-slate-500 light:hover:bg-slate-900/5 light:hover:text-slate-900"
                  >
                    {option.label}
                  </NavLink>
                ))}
              </div>
            </details>

            <details className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium text-slate-200 transition-colors duration-150 hover:bg-white/5 hover:text-white light:text-slate-700 light:hover:bg-slate-900/5 light:hover:text-slate-900 [&::-webkit-details-marker]:hidden">
                Categorías
                <ChevronDown className="h-4 w-4 shrink-0 text-slate-500 transition-transform duration-200 group-open:rotate-180" />
              </summary>
              <div className="flex flex-col gap-1 py-1 pl-3">
                {CATEGORY_ITEMS.map((category) => (
                  <NavLink
                    key={category.label}
                    to={category.to}
                    onClick={() => setMobileOpen(false)}
                    className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400 transition-colors duration-150 hover:bg-white/5 hover:text-white light:text-slate-500 light:hover:bg-slate-900/5 light:hover:text-slate-900"
                  >
                    <span aria-hidden>{category.emoji}</span>
                    {category.label}
                  </NavLink>
                ))}
              </div>
            </details>

            <NavLink
              to="/como-funciona"
              onClick={() => setMobileOpen(false)}
              className="rounded-lg px-3 py-2.5 text-sm font-medium text-slate-200 transition-colors duration-150 hover:bg-white/5 hover:text-white light:text-slate-700 light:hover:bg-slate-900/5 light:hover:text-slate-900"
            >
              ¿Cómo funciona?
            </NavLink>
            <NavLink
              to={isOrganizer ? "/organizador" : "/para-organizadores"}
              onClick={() => setMobileOpen(false)}
              className="rounded-lg px-3 py-2.5 text-sm font-medium text-slate-200 transition-colors duration-150 hover:bg-white/5 hover:text-white light:text-slate-700 light:hover:bg-slate-900/5 light:hover:text-slate-900"
            >
              Para organizadores
            </NavLink>
            <NavLink
              to="/recuperar-compra"
              onClick={() => setMobileOpen(false)}
              className="rounded-lg px-3 py-2.5 text-sm font-medium text-slate-200 transition-colors duration-150 hover:bg-white/5 hover:text-white light:text-slate-700 light:hover:bg-slate-900/5 light:hover:text-slate-900"
            >
              Recuperar mis entradas
            </NavLink>
            <NavLink
              to="/arrepentimiento"
              onClick={() => setMobileOpen(false)}
              className="rounded-lg px-3 py-2.5 text-sm font-medium text-slate-200 transition-colors duration-150 hover:bg-white/5 hover:text-white light:text-slate-700 light:hover:bg-slate-900/5 light:hover:text-slate-900"
            >
              Botón de arrepentimiento
            </NavLink>
            {isDeveloper && (
              <Link
                to="/developer"
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-1.5 rounded-lg px-3 py-2.5 text-sm font-medium text-violet-400 transition-colors duration-150 hover:bg-white/5"
              >
                <LayoutDashboard className="h-4 w-4" />
                Panel developer
              </Link>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
