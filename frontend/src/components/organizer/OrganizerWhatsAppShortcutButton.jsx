import { MessageCircle, Lock } from "lucide-react";
import { useBackendUser } from "../../context/AuthContext.jsx";
import { useOrganizerSession } from "../../context/OrganizerSessionContext.jsx";
import { useToast } from "../../context/ToastContext.jsx";

// Atajo GLOBAL — montado UNA sola vez en App.jsx, por ENCIMA de la
// separación entre rutas públicas/AppShell/panel Organizer (ver el informe
// de entrega "globalización del botón"), nunca dentro de una rama de rutas.
// Por eso sigue visible cuando un Organizer autenticado navega de su panel a
// la Home pública, /eventos, el detalle de un evento, etc. — y no cuando
// cambia de "/organizador" a "/" (esa era la causa real del bug detectado:
// antes vivía dentro de la rama de rutas de "/organizador", que se
// desmonta por completo al navegar a cualquier ruta pública).
//
// `organization`/`whatsappEventLink` vienen de OrganizerSessionContext
// (fuente global y liviana, nunca carga events/sales/stats) — este
// componente nunca dispara su propio fetch.
//
// PREMIUM real vs FREE se sigue decidiendo en el backend (el bot de
// WhatsApp, ver blockIfWhatsappEventCreationUnavailable en
// whatsapp.controller.js): acá sólo se lee `organization.plan` para decidir
// la UX (abrir WhatsApp vs. mostrar el aviso) — un FREE que se salteara este
// botón y armara la URL a mano igual sería frenado por el bot.
export default function OrganizerWhatsAppShortcutButton() {
  const { backendUser, syncing } = useBackendUser();
  const { organization, loadingOrganization, whatsappEventLink } = useOrganizerSession();
  const toast = useToast();

  const role = backendUser?.role?.toLowerCase();

  // Mientras el rol todavía no se conoce (syncing), o el rol resuelto no es
  // "organizer" (incluye no autenticado, tras logout, u otro rol): nunca
  // renderizar nada — ni siquiera fugazmente.
  if (syncing || role !== "organizer") return null;

  // Organizer confirmado, pero `organization`/`plan` todavía no llegó (o el
  // fetch falló): tampoco se muestra. Evita tratar a un Organizer PREMIUM
  // como FREE por un instante mientras carga.
  if (loadingOrganization || !organization) return null;

  const isPremium = organization.plan === "PREMIUM";

  const baseClass =
    "fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] right-4 z-50 flex items-center gap-2.5 rounded-full px-5 py-3.5 text-sm font-semibold shadow-lg shadow-black/30 outline-none transition-all duration-150 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#05070B] light:focus-visible:ring-offset-slate-50 light:shadow-slate-400/30 sm:bottom-6 sm:right-6 sm:px-6 sm:py-4 sm:text-base";

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
