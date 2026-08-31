import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Camera, ThumbsUp, Clapperboard, Globe, MapPin, Ticket } from "lucide-react";
import { apiFetch } from "../../lib/api.js";
import EventCard from "../../components/marketplace/EventCard.jsx";
import { buildOrganizationTheme, toOrgThemeStyle, ORG_THEME_CLASS } from "../../lib/organizationTheme.js";
import { useRegisterPublicBranding } from "../../context/PublicBrandingContext.jsx";

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

export default function OrganizationProfile() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotFound(false);

    apiFetch(`/api/organizations/public/${slug}`)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        console.error("No se pudo cargar la organización", err);
        if (!cancelled) setNotFound(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  usePageTitle(data?.organization?.name ? `${data.organization.name} | PaseCultural` : "PaseCultural");

  // branding.primaryColor sólo llega no-nulo cuando el backend ya evaluó
  // CUSTOM_BRANDING disponible (ver getPublicOrganizationBySlugService) —
  // acá nunca se vuelve a chequear plan, sólo se reacciona a lo que el
  // backend ya autorizó.
  const publicBranding =
    data?.branding?.primaryColor
      ? {
          slug: data.organization.slug,
          name: data.organization.name,
          logo: data.branding.logo,
          theme: buildOrganizationTheme(data.branding.primaryColor, data.branding.secondaryColor),
        }
      : null;
  useRegisterPublicBranding(publicBranding);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-slate-400">
        Cargando organización...
      </div>
    );
  }

  // FREE y slug inexistente llegan acá con el mismo estado — el backend ya
  // devuelve el mismo 404 uniforme para ambos casos, y esta pantalla nunca
  // intenta distinguirlos.
  if (notFound || !data) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 px-6 py-24 text-center">
        <p className="text-lg font-semibold text-white">Página no disponible</p>
        <p className="text-sm text-slate-400">
          Esta organización no tiene una página pública disponible.
        </p>
      </div>
    );
  }

  const { organization, branding, events } = data;

  // Organization Theme scope acotado a este subárbol vía custom properties
  // inline (ver lib/organizationTheme.js) — nunca toca
  // document.documentElement/body/:root ni ningún estado global, y no deja
  // nada vivo después de desmontar (no es un efecto, es sólo estilo).
  // El fondo/superficie derivados sólo se pintan cuando hay theme —
  // Organization FREE (o slug sin branding) sigue heredando el fondo
  // estándar de PublicShell (#05070B), sin masa de color agregada.
  const rootStyle = publicBranding
    ? { ...toOrgThemeStyle(publicBranding.theme), backgroundColor: "var(--org-background)", borderRadius: "1.5rem" }
    : undefined;
  const rootClassName = publicBranding ? ORG_THEME_CLASS : "";

  const safeSocialLinks = SOCIAL_FIELDS.map(({ key, label, Icon }) => ({
    key,
    label,
    Icon,
    url: organization[key],
  })).filter((link) => isSafeExternalUrl(link.url));

  return (
    <div
      style={rootStyle}
      className={`${rootClassName} mx-auto flex max-w-5xl flex-col gap-8 px-6 py-10`}
    >
      <div className="flex flex-col items-center gap-4 text-center">
        {/* Área principal de la Organization — Premium Fase 2D.1.1: cuando
            hay branding, este bloque usa --org-primary como fondo REAL (no
            un derivado oscurecido), con --org-on-primary para el texto
            encima, para que el color elegido tenga presencia visual
            evidente en vez de sólo teñir un fondo casi negro. Sin branding,
            es transparente (fondo estándar de PublicShell). */}
        <div
          style={
            publicBranding
              ? { backgroundColor: "var(--org-primary)", color: "var(--org-on-primary)" }
              : undefined
          }
          className={`flex flex-col items-center gap-4 ${publicBranding ? "w-full rounded-2xl px-6 py-8" : ""}`}
        >
          {/* Logo SÓLO desde branding.logo, nunca organization.logo — es lo
              que mantiene CUSTOM_BRANDING realmente independiente de
              PUBLIC_ORGANIZATION_PAGE. */}
          {branding.logo && (
            <img
              src={branding.logo}
              alt={organization.name}
              className={`h-20 w-20 rounded-full object-cover ${publicBranding ? "" : "border border-white/10"}`}
              style={publicBranding ? { border: "2px solid var(--org-on-primary)" } : undefined}
            />
          )}
          <div>
            <h1 className={`text-2xl font-bold sm:text-3xl ${publicBranding ? "" : "text-white"}`}>
              {organization.name}
            </h1>
            {(organization.city || organization.province) && (
              <p
                className={`mt-1 flex items-center justify-center gap-1.5 text-sm ${
                  publicBranding ? "opacity-80" : "text-slate-400"
                }`}
              >
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                {[organization.city, organization.province].filter(Boolean).join(", ")}
              </p>
            )}
          </div>
        </div>
        {organization.description && (
          <p className="max-w-xl whitespace-pre-line text-sm text-slate-300">
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
                className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 transition-colors duration-150 hover:border-[var(--brand-color,theme(colors.violet.500))] hover:text-white"
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </a>
            ))}
          </div>
        )}

        <p className="flex items-center gap-1.5 text-xs text-slate-600">
          <Ticket className="h-3.5 w-3.5" />
          Powered by PaseCultural
        </p>
      </div>

      <div className="border-t border-white/10 pt-8">
        <h2 className="mb-5 text-lg font-semibold text-white">Próximos eventos</h2>

        {events.length === 0 ? (
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
