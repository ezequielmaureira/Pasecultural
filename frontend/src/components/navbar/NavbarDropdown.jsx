import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { useClickOutside } from "../../lib/useClickOutside.js";

// Dropdown reutilizable del Navbar público: fade + pequeño desplazamiento
// vertical al abrir/cerrar, cierre al clickear afuera o con Escape, y
// navegación por teclado (↑/↓ entre ítems). Lo usan tanto los menús de
// texto ("Explorar eventos", "Categorías") como el menú de usuario, pasando
// un `trigger` propio (el avatar) en vez de `label`.
export default function NavbarDropdown({ label, trigger, items, align = "left" }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const triggerRef = useRef(null);
  const itemRefs = useRef([]);

  useClickOutside(containerRef, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    itemRefs.current[0]?.focus();
  }, [open]);

  function close() {
    setOpen(false);
  }

  function handleTriggerKeyDown(event) {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen(true);
    }
  }

  function handleMenuKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      triggerRef.current?.focus();
      return;
    }

    const focusable = itemRefs.current.filter(Boolean);
    if (focusable.length === 0) return;
    const currentIndex = focusable.indexOf(document.activeElement);

    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusable[(currentIndex + 1) % focusable.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusable[(currentIndex - 1 + focusable.length) % focusable.length]?.focus();
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={handleTriggerKeyDown}
        className={
          trigger
            ? ""
            : "flex items-center gap-1 py-1 text-sm font-medium text-slate-300 transition-colors duration-150 hover:text-white"
        }
      >
        {trigger ?? (
          <>
            {label}
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
            />
          </>
        )}
      </button>

      <div
        role="menu"
        onKeyDown={handleMenuKeyDown}
        className={`absolute top-full z-30 mt-3 min-w-[15rem] origin-top rounded-xl border border-white/10 bg-[#0B1120] p-1.5 shadow-xl shadow-black/40 transition-all duration-150 ease-out ${
          align === "right" ? "right-0" : "left-0"
        } ${
          open
            ? "visible translate-y-0 opacity-100"
            : "invisible -translate-y-1 opacity-0 pointer-events-none"
        }`}
      >
        {items.map((item, index) => {
          const content = (
            <>
              {item.emoji && <span aria-hidden>{item.emoji}</span>}
              {item.icon && <item.icon className="h-4 w-4 shrink-0" />}
              <span className="truncate">{item.label}</span>
            </>
          );

          const itemClassName = `flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors duration-150 ${
            item.danger
              ? "text-rose-400 hover:bg-rose-500/10"
              : "text-slate-300 hover:bg-white/5 hover:text-white"
          }`;

          if (item.onClick) {
            return (
              <button
                key={item.label}
                ref={(el) => (itemRefs.current[index] = el)}
                type="button"
                role="menuitem"
                onClick={() => {
                  item.onClick();
                  close();
                }}
                className={itemClassName}
              >
                {content}
              </button>
            );
          }

          return (
            <Link
              key={item.label}
              ref={(el) => (itemRefs.current[index] = el)}
              to={item.to}
              role="menuitem"
              onClick={close}
              className={itemClassName}
            >
              {content}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
