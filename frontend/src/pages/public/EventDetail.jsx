import { useEffect, useState } from "react";
import { useParams, Link, useNavigate, useLocation, Navigate } from "react-router-dom";
import { CalendarDays, MapPin, Clock3, ImageOff, ArrowLeft } from "lucide-react";
import Card from "../../components/ui/Card.jsx";
import Button from "../../components/ui/Button.jsx";
import SocialLinks from "../../components/events/SocialLinks.jsx";
import MediaEmbed from "../../components/events/MediaEmbed.jsx";
import LocationMap from "../../components/location/LocationMap.jsx";
import { apiFetch } from "../../lib/api.js";
import { getEventCategoryLabel } from "../../lib/eventCategories.js";
import { isEventFinished } from "../../lib/eventFinished.js";
import {
  formatEventDateTime,
  formatEventLocation,
  formatEventPrice,
} from "../../lib/eventFormat.js";

export default function EventDetail() {
  const { slug } = useParams();
  const [event, setEvent] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();
  // Ver comentario en QuickPass.jsx ("VER DETALLE DEL EVENTO") — distingue
  // un link directo/compartido (sin state, el caso que el redirect de abajo
  // sigue cubriendo) de la navegación explícita desde dentro de Fest Pass.
  const forceEventDetail = Boolean(location.state?.forceEventDetail);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotFound(false);

    apiFetch(`/api/events/public/${slug}`)
      .then(({ event: data }) => {
        if (!cancelled) setEvent(data);
      })
      .catch((err) => {
        console.error("No se pudo cargar el evento", err);
        if (!cancelled) setNotFound(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-slate-400">
        Cargando evento...
      </div>
    );
  }

  // Fest Pass — cubre el caso de un link directo/compartido a /evento/:slug
  // (nunca pasó por el listado, donde EventCard/HeroCarousel ya resuelven
  // esto): si el Event que llegó tiene quickPassEnabled, este detalle
  // ESTÁNDAR nunca debe llegar a renderizarse — se redirige una sola vez,
  // de forma canónica, a la experiencia real (/fest-pass/:slug, mismo
  // componente QuickPass.jsx). Sin loop posible: esa ruta monta un
  // componente completamente distinto que nunca redirige de vuelta acá.
  //
  // EXCEPCIÓN — `forceEventDetail`: cuando la navegación viene del botón
  // "VER DETALLE DEL EVENTO"/"VER EVENTO" DENTRO de Fest Pass (QuickPass.jsx),
  // el usuario pidió EXPLÍCITAMENTE ver este detalle normal — redirigirlo de
  // nuevo a Fest Pass acá volvería ese botón inútil (Fest Pass -> "Ver
  // detalle" -> este redirect -> Fest Pass otra vez, sin mostrar nunca el
  // detalle). Un link directo/compartido nunca trae este state, así que
  // sigue redirigiendo exactamente igual que antes.
  if (event?.quickPassEnabled && !forceEventDetail) {
    return <Navigate to={`/fest-pass/${event.slug}`} replace />;
  }

  if (notFound || !event) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 px-6 py-24 text-center">
        <p className="text-lg font-semibold text-white light:text-slate-900">Evento no encontrado</p>
        <p className="text-sm text-slate-400 light:text-slate-600">
          Puede que ya no esté disponible o que el enlace sea incorrecto.
        </p>
        <Link to="/eventos">
          <Button variant="secondary" className="mt-2">
            <ArrowLeft className="h-4 w-4" />
            Volver a eventos
          </Button>
        </Link>
      </div>
    );
  }

  const finished = isEventFinished(event);

  return (
    <div className="relative mx-auto flex max-w-5xl flex-col gap-6 px-6 py-10">
      {/* Capa ambiental como elemento DOM real (no pseudo-elemento con
          z-index negativo) — mismo principio ya usado en Home.jsx
          (.smarticket-neon-page-ambient): reutiliza la imagen de portada
          del evento como atmósfera de fondo (blur fuerte + escala leve
          para tapar bordes + overlay oscuro/color encima). Sin imagen,
          queda sólo el velo de marca. Al ser el PRIMER hijo y no tener
          z-index negativo, pinta detrás del contenido siguiente sin
          depender de escapar a ningún stacking context ajeno. */}
      <div
        className="smarticket-event-ambient"
        aria-hidden="true"
        style={event.coverImage ? { backgroundImage: `url(${event.coverImage})` } : undefined}
      />

      {/* Wrapper con `position:relative` (sin z-index) — igual que en
          Home.jsx: el contenido real de esta página (Link, imagen
          principal, grid) es en su mayoría `position:static`, que sin
          este wrapper pintaría ANTES (detrás) de la capa ambiental
          `position:absolute` de arriba, sin importar el orden del DOM. */}
      <div className="relative flex flex-col gap-6">
        <Link
          to="/eventos"
          className="flex w-fit items-center gap-1.5 text-sm text-slate-400 hover:text-white light:text-slate-500 light:hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver a eventos
        </Link>

        <div className="mx-auto w-full max-w-xs overflow-hidden rounded-3xl border border-white/15 bg-white/5 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.65)] sm:max-w-sm light:border-slate-200 light:bg-white light:shadow-slate-300/50">
          <div className="aspect-[4/5] w-full bg-black/30">
            {event.coverImage ? (
              <img
                src={event.coverImage}
                alt={event.title}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-slate-600">
                <ImageOff className="h-8 w-8" />
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="flex flex-col gap-6 lg:col-span-2">
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                {event.category && (
                  <span className="rounded-full border border-white/15 bg-violet-500/10 px-2.5 py-1 text-xs font-medium text-violet-300 backdrop-blur-sm light:border-violet-200 light:bg-violet-50 light:text-violet-700">
                    {getEventCategoryLabel(event)}
                  </span>
                )}
                {event.organization?.name && (
                  <span className="text-xs text-slate-500 light:text-slate-600">
                    Organiza {event.organization.name}
                  </span>
                )}
              </div>
              <h1 className="text-2xl font-bold text-white sm:text-3xl light:text-slate-900">{event.title}</h1>
              {event.shortDescription && (
                <p className="text-sm text-slate-300 light:text-slate-700">{event.shortDescription}</p>
              )}
            </div>

            {event.links?.some((link) => link.isEmbeddable) && (
              <div className="flex flex-col gap-4">
                {event.links
                  .filter((link) => link.isEmbeddable)
                  .map((link) => (
                    <MediaEmbed key={link.id} embedUrl={link.embedUrl} title={link.title} />
                  ))}
              </div>
            )}

            {event.description && (
              <Card variant="glass" title="Sobre el evento">
                <p className="whitespace-pre-line text-sm text-slate-300 light:text-slate-700">
                  {event.description}
                </p>
              </Card>
            )}

            {event.links?.some((link) => !link.isEmbeddable) && (
              <Card variant="glass">
                <SocialLinks links={event.links} />
              </Card>
            )}

            <Card variant="glass" title="Ubicación">
              {(event.city || event.province) && (
                <p className="mb-3 text-xs text-slate-500 light:text-slate-600">
                  {[event.city, event.province].filter(Boolean).join(", ")}
                </p>
              )}
              <LocationMap
                latitude={event.latitude}
                longitude={event.longitude}
                venueName={event.venueName || event.venue}
                formattedAddress={event.formattedAddress || event.addressLine || event.address}
              />
            </Card>
          </div>

          <div className="flex flex-col gap-4">
            <Card variant="glass">
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <CalendarDays className="h-4 w-4 shrink-0 text-slate-500 light:text-slate-500" />
                  <span className="text-sm text-slate-300 light:text-slate-700">
                    {formatEventDateTime(event.startDate)}
                  </span>
                </div>
                {event.doorsOpenAt && (
                  <div className="flex items-center gap-3">
                    <Clock3 className="h-4 w-4 shrink-0 text-slate-500 light:text-slate-500" />
                    <span className="text-sm text-slate-300 light:text-slate-700">
                      Apertura de puertas: {formatEventDateTime(event.doorsOpenAt)}
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <MapPin className="h-4 w-4 shrink-0 text-slate-500 light:text-slate-500" />
                  <span className="text-sm text-slate-300 light:text-slate-700">
                    {formatEventLocation(event)}
                  </span>
                </div>

                {finished ? (
                  <div className="border-t border-white/10 pt-4 light:border-slate-200">
                    <p className="rounded-lg bg-white/5 px-3 py-2 text-center text-sm font-medium text-slate-300 light:bg-slate-100 light:text-slate-700">
                      Este evento finalizó
                    </p>
                  </div>
                ) : event.admissionType === "FREE_ENTRY" ? (
                  <div className="border-t border-white/10 pt-4 light:border-slate-200">
                    <p className="text-xs text-slate-500 light:text-slate-600">Precio</p>
                    <p className="text-lg font-bold text-violet-400 light:text-violet-600">Entrada gratuita</p>
                    <p className="mt-1 text-xs text-slate-500 light:text-slate-600">Ingreso por orden de llegada.</p>
                  </div>
                ) : (
                  <>
                    <div className="border-t border-white/10 pt-4 light:border-slate-200">
                      <p className="text-xs text-slate-500 light:text-slate-600">Precio</p>
                      <p className="text-lg font-bold text-violet-400 light:text-violet-600">
                        {formatEventPrice(event)}
                      </p>
                    </div>

                    {/* CTA local — mismo `.smarticket-hero-cta` ya usado en
                        HeroCarousel.jsx (pill, gradiente fucsia→violeta→azul,
                        glow calcado del CTA real de QuickPass.jsx,
                        active:scale) en vez del `Button.jsx` compartido, para
                        no afectar Organizer/Scanner/Developer. Handler,
                        navegación y validaciones sin ningún cambio. */}
                    <button
                      type="button"
                      className="smarticket-hero-cta w-full"
                      onClick={() =>
                        // `forceEventDetail` es la ÚNICA forma de llegar a este
                        // detalle con quickPassEnabled=true (ver el redirect de
                        // arriba) — en ese caso "Comprar" tiene que entrar al
                        // checkout neón real (/fest-pass/:slug), nunca al
                        // checkout estándar (/comprar), que no tiene la
                        // experiencia Fest Pass.
                        navigate(
                          event.quickPassEnabled
                            ? `/fest-pass/${event.slug}`
                            : `/comprar?slug=${event.slug}&functionId=${event.functions?.[0]?.id}`
                        )
                      }
                    >
                      Comprar Entradas
                    </button>
                    <p className="text-center text-xs text-slate-500 light:text-slate-600">Irás al checkout para completar la compra.</p>
                  </>
                )}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
