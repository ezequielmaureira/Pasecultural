import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Camera, ThumbsUp, Clapperboard, Globe, MapPin, Ticket } from "lucide-react";
import { apiFetch } from "../../lib/api.js";
import EventCard from "../../components/marketplace/EventCard.jsx";

// Mismo patrón que PrivacyPolicy.jsx/DataDeletion.jsx: no hay ninguna
// librería de metadata en el proyecto, así que esto es el único punto que
// toca document.title, acotado a esta página, restaurado al desmontar.
function usePageTitle(title) {
  useEffect(() => {
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
}

// Hardening puntual de ESTA página nueva (Fase 2D) — riesgo conocido y
// deliberadamente no tocado en otro lado (ver SocialLinks.jsx, que hoy
// renderiza website/redes como link sin validar esquema). Acá sólo se evita
// que un valor guardado con esquema no-http/https (javascript:, data:, etc.)
// se vuelva clickeable — no se modifica ni se "arregla" el dato persistido.
function isSafeExternalUrl(value) {
  if (!value || typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

const SOCIAL_FIELDS = [
  { key: "website", label: "Sitio web", Icon: Globe },
  { key: "instagram", label: "Instagram", Icon: Camera },
  { key: "facebook", label: "Facebook", Icon: ThumbsUp },
  { key: "tiktok", label: "TikTok", Icon: Clapperboard },
];

// Fast Organization Public Experience — dos cargas INDEPENDIENTES desde que
// se conoce `slug`, cada una en su propio useEffect, arrancando juntas sin
// que una espere a la otra (nunca un Promise.all: eso volvería a bloquear el
// render sobre la respuesta más lenta de las dos). `events` viene de
// GET /api/events/public?organizationSlug=... (el MISMO event.findMany que ya
// usa /eventos, filtrado en la propia query — nunca un segundo fetch de
// identidad primero para resolver slug->id). `identity` viene de
// GET /api/organizations/public/:slug?includeEvents=false (que ya NO corre su
// propio event.findMany). El backend de identidad sigue siendo la autoridad
// para "página no disponible" (FREE/inexistente): mientras identity no
// resuelva, nunca se muestra ese estado sólo porque events haya llegado
// vacío — un evento cargado no implica nombre/logo/existencia.
export default function OrganizationProfile() {
  const { slug } = useParams();

  const [events, setEvents] = useState([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [eventsError, setEventsError] = useState(false);

  const [identity, setIdentity] = useState(null);
  const [loadingIdentity, setLoadingIdentity] = useState(true);
  const [identityNotFound, setIdentityNotFound] = useState(false);
  const [identityError, setIdentityError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadingEvents(true);
    setEventsError(false);

    apiFetch(`/api/events/public?organizationSlug=${encodeURIComponent(slug)}`)
      .then((result) => {
        if (!cancelled) setEvents(result.events ?? []);
      })
      .catch((err) => {
        console.error("No se pudieron cargar los eventos de la organización", err);
        if (!cancelled) setEventsError(true);
      })
      .finally(() => {
        if (!cancelled) setLoadingEvents(false);
      });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    let cancelled = false;
    setLoadingIdentity(true);
    setIdentityNotFound(false);
    setIdentityError(false);

    apiFetch(`/api/organizations/public/${slug}?includeEvents=false`)
      .then((result) => {
        if (!cancelled) setIdentity(result.organization);
      })
      .catch((err) => {
        console.error("No se pudo cargar la organización", err);
        if (cancelled) return;
        // ORGANIZATION_PUBLIC_PAGE_NOT_AVAILABLE llega como 404/403 — ver
        // ErrorCatalog. Cualquier OTRO fallo (red, 500) es técnico/temporal,
        // nunca "no disponible": no hay forma de distinguir el código exacto
        // acá (apiFetch no lo expone), así que se trata como notFound sólo
        // cuando es un error de respuesta HTTP conocido del backend — mismo
        // criterio que el comportamiento previo a esta fase (backend sigue
        // siendo la única autoridad de "no disponible").
        if (err.status && err.status !== 500) {
          setIdentityNotFound(true);
        } else {
          setIdentityError(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingIdentity(false);
      });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  usePageTitle(identity?.name ? `${identity.name} | Smarticket` : "Smarticket");

  // Mientras identidad no resolvió, nunca se puede afirmar "no disponible"
  // ni tampoco es seguro renderizar nombre/logo todavía — eventos SÍ puede
  // ya estar listo y se muestra igual (ver más abajo), pero el encabezado
  // de identidad espera su propia respuesta.
  if (loadingIdentity) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-slate-400">
        Cargando organización...
      </div>
    );
  }

  // FREE y slug inexistente llegan acá con el mismo estado — el backend ya
  // devuelve el mismo 404 uniforme para ambos casos, y esta pantalla nunca
  // intenta distinguirlos. Autoridad exclusiva del backend de identidad:
  // aunque `events` ya haya resuelto con contenido, el filtro
  // organization.plan=PREMIUM de getPublicEventsService garantiza que una
  // FREE nunca llegó a tener eventos acá de todas formas.
  if (identityNotFound || (!identity && !identityError)) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 px-6 py-24 text-center">
        <p className="text-lg font-semibold text-white">Página no disponible</p>
        <p className="text-sm text-slate-400">
          Esta organización no tiene una página pública disponible.
        </p>
      </div>
    );
  }

  // Fallo técnico de identidad (no "no disponible") con eventos ya
  // utilizables: se prefiere mostrar el contenido básico (grilla de eventos)
  // en vez de bloquear toda la página por un problema temporal de UNA de las
  // dos requests — mismo criterio de "no perder lo que sí funcionó" que ya
  // usa el resto del proyecto ante errores parciales.
  const organization = identity;

  const safeSocialLinks = organization
    ? SOCIAL_FIELDS.map(({ key, label, Icon }) => ({
        key,
        label,
        Icon,
        url: organization[key],
      })).filter((link) => isSafeExternalUrl(link.url))
    : [];

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-10">
      {organization ? (
        <div className="flex flex-col items-center gap-4 text-center">
          {organization.logo && (
            <img
              src={organization.logo}
              alt={organization.name}
              className="h-20 w-20 rounded-full border border-white/10 object-cover"
            />
          )}
          <div>
            <h1 className="text-2xl font-bold text-white sm:text-3xl light:text-slate-900">{organization.name}</h1>
            {(organization.city || organization.province) && (
              <p className="mt-1 flex items-center justify-center gap-1.5 text-sm text-slate-400 light:text-slate-500">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                {[organization.city, organization.province].filter(Boolean).join(", ")}
              </p>
            )}
          </div>
          {organization.description && (
            <p className="max-w-xl whitespace-pre-line text-sm text-slate-300 light:text-slate-600">
              {organization.description}
            </p>
          )}

          {safeSocialLinks.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-2">
              {safeSocialLinks.map(({ key, label, Icon, url }) => (
                <a
                  key={key}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 transition-colors duration-150 hover:border-violet-500 hover:text-white"
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </a>
              ))}
            </div>
          )}

          <p className="flex items-center gap-1.5 text-xs text-slate-600">
            <Ticket className="h-3.5 w-3.5" />
            Powered by Smarticket
          </p>
        </div>
      ) : (
        // identityError=true: fallo técnico, no "no disponible" — se omite
        // el encabezado (no hay nombre/logo/redes confiables todavía) pero
        // se sigue mostrando la grilla de eventos si ya cargó.
        <p className="text-center text-sm text-slate-500">
          No pudimos cargar los datos de la organización en este momento.
        </p>
      )}

      <div className="border-t border-white/10 pt-8">
        <h2 className="mb-5 text-lg font-semibold text-white light:text-slate-900">Próximos eventos</h2>

        {loadingEvents ? (
          <p className="py-10 text-center text-sm text-slate-500">Cargando eventos...</p>
        ) : eventsError ? (
          <p className="py-10 text-center text-sm text-slate-500">
            No pudimos cargar los eventos en este momento.
          </p>
        ) : events.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">
            Esta organización no tiene eventos publicados por ahora.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {events.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
