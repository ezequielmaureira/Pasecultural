import { MessageCircle, Lock } from "lucide-react";
import { useOrganizerData } from "../../context/OrganizerDataContext.jsx";
import { useToast } from "../../context/ToastContext.jsx";

// Atajo global del panel Organizer — flotante, montado UNA sola vez en el
// shell de "/organizador" (ver App.jsx), nunca página por página: cualquier
// pantalla futura que cuelgue de ese mismo shell lo hereda automáticamente.
// `organization`/`whatsappEventLink` vienen de OrganizerDataContext (ya
// cargados una vez para todo el panel) — este componente nunca dispara su
// propio fetch.
//
// PREMIUM real vs FREE se sigue decidiendo en el backend (el bot de
// WhatsApp, ver blockIfWhatsappEventCreationUnavailable en
// whatsapp.controller.js): acá sólo se lee `organization.plan` para decidir
// la UX (abrir WhatsApp vs. mostrar el aviso) — un FREE que se salteara este
// botón y armara la URL a mano igual sería frenado por el bot.
export default function OrganizerWhatsAppShortcutButton() {
  const { organization, loadingOrganization, whatsappEventLink } = useOrganizerData();
  const toast = useToast();

  // Nada que mostrar todavía (primer render) o no hay Organization
  // resuelta (nunca debería pasar dentro de "/organizador", pero evita un
  // botón roto si el fetch de arriba falló).
  if (loadingOrganization || !organization) return null;

  const isPremium = organization.plan === "PREMIUM";

  const baseClass =
    "fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] right-4 z-50 flex items-center gap-2.5 rounded-full px-5 py-3.5 text-sm font-semibold shadow-lg shadow-black/30 outline-none transition-all duration-150 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#05070B] sm:bottom-6 sm:right-6 sm:px-6 sm:py-4 sm:text-base";

  if (isPremium) {
    return (
      <a
        href={whatsappEventLink || undefined}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Cargá tu evento con WhatsApp"
        aria-disabled={!whatsappEventLink}
        onClick={(event) => {
          if (!whatsappEventLink) {
            event.preventDefault();
            toast.info("Estamos preparando el enlace de WhatsApp. Probá de nuevo en un segundo.");
          }
        }}
        className={`${baseClass} bg-emerald-500 text-white hover:bg-emerald-400 focus-visible:ring-emerald-400 ${
          whatsappEventLink ? "" : "cursor-wait opacity-90"
        }`}
      >
        <MessageCircle className="h-5 w-5 shrink-0" aria-hidden />
        <span>Cargá tu evento con WhatsApp</span>
      </a>
    );
  }

  return (
    <button
      type="button"
      aria-label="Cargá tu evento con WhatsApp — función Premium"
      onClick={() =>
        toast.info(
          "Esta función está disponible para organizaciones Premium. Pasate a Premium para cargar eventos directamente por WhatsApp.",
          { duration: 6000 }
        )
      }
      className={`${baseClass} bg-emerald-500/25 text-emerald-100 hover:bg-emerald-500/35 focus-visible:ring-emerald-400`}
    >
      <MessageCircle className="h-5 w-5 shrink-0" aria-hidden />
      <span>Cargá tu evento con WhatsApp</span>
      <Lock className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
    </button>
  );
}
