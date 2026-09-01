import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { CalendarDays, MapPin, Clock3, ImageOff, ArrowLeft } from "lucide-react";
import Card from "../../components/ui/Card.jsx";
import Button from "../../components/ui/Button.jsx";
import SocialLinks from "../../components/events/SocialLinks.jsx";
import MediaEmbed from "../../components/events/MediaEmbed.jsx";
import LocationMap from "../../components/location/LocationMap.jsx";
import { apiFetch } from "../../lib/api.js";
import { getEventCategoryLabel } from "../../lib/eventCategories.js";
import {
  formatEventDateTime,
  formatEventLocation,
  formatEventPrice,
} from "../../lib/eventFormat.js";
import { useOrganizationThemeProps } from "../../hooks/useOrganizationThemeProps.js";

export default function EventDetail() {
  const { slug } = useParams();
  const [event, setEvent] = useState(null);
  const navigate = useNavigate();
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

  // Theme SIEMPRE según la Organization dueña del evento, nunca según el
  // origen de navegación (Home, /eventos, link directo o compartido) — el
  // evento pertenece a esa Organization y esa es su identidad.
  const { className: themeClassName, style: themeStyle } = useOrganizationThemeProps({
    slug: event?.organization?.slug,
    name: event?.organization?.name,
    logo: event?.organization?.branding?.logo,
    enabled: event?.organization?.branding?.enabled,
  });

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-slate-400">
        Cargando evento...
      </div>
    );
  }

  if (notFound || !event) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 px-6 py-24 text-center">
        <p className="text-lg font-semibold text-white">Evento no encontrado</p>
        <p className="text-sm text-slate-400">
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

  return (
    <div style={themeStyle} className={`${themeClassName} mx-auto flex max-w-5xl flex-col gap-6 px-6 py-10`}>
      <Link
        to="/eventos"
        className="flex w-fit items-center gap-1.5 text-sm text-slate-400 hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" />
        Volver a eventos
      </Link>

      <div className="mx-auto w-full max-w-xs overflow-hidden rounded-2xl border border-white/10 bg-[#0B1120] sm:max-w-sm">
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
                <span className="rounded-full bg-violet-500/10 px-2.5 py-1 text-xs font-medium text-violet-300">
                  {getEventCategoryLabel(event)}
                </span>
              )}
              {event.organization?.name && (
                <span className="text-xs text-slate-500">
                  Organiza {event.organization.name}
                </span>
              )}
            </div>
            <h1 className="text-2xl font-bold text-white sm:text-3xl">{event.title}</h1>
            {event.shortDescription && (
              <p className="text-sm text-slate-300">{event.shortDescription}</p>
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
            <Card title="Sobre el evento">
              <p className="whitespace-pre-line text-sm text-slate-300">
                {event.description}
              </p>
            </Card>
          )}

          {event.links?.some((link) => !link.isEmbeddable) && (
            <Card>
              <SocialLinks links={event.links} />
            </Card>
          )}

          <Card title="Ubicación">
            {(event.city || event.province) && (
              <p className="mb-3 text-xs text-slate-500">
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
          <Card>
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <CalendarDays className="h-4 w-4 shrink-0 text-slate-500" />
                <span className="text-sm text-slate-300">
                  {formatEventDateTime(event.startDate)}
                </span>
              </div>
              {event.doorsOpenAt && (
                <div className="flex items-center gap-3">
                  <Clock3 className="h-4 w-4 shrink-0 text-slate-500" />
                  <span className="text-sm text-slate-300">
                    Apertura de puertas: {formatEventDateTime(event.doorsOpenAt)}
                  </span>
                </div>
              )}
              <div className="flex items-center gap-3">
                <MapPin className="h-4 w-4 shrink-0 text-slate-500" />
                <span className="text-sm text-slate-300">
                  {formatEventLocation(event)}
                </span>
              </div>

              {event.admissionType === "FREE_ENTRY" ? (
                <div className="border-t border-white/10 pt-4">
                  <p className="text-xs text-slate-500">Precio</p>
                  <p className="text-lg font-bold text-violet-400">Entrada gratuita</p>
                  <p className="mt-1 text-xs text-slate-500">Ingreso por orden de llegada.</p>
                </div>
              ) : (
                <>
                  <div className="border-t border-white/10 pt-4">
                    <p className="text-xs text-slate-500">Precio</p>
                    <p className="text-lg font-bold text-violet-400">
                      {formatEventPrice(event)}
                    </p>
                  </div>

                  <Button
                    size="lg"
                    className="justify-center"
                    onClick={() => navigate(`/comprar?slug=${event.slug}&functionId=${event.functions?.[0]?.id}`)}
                  >
                    Comprar Entradas
                  </Button>
                  <p className="text-center text-xs text-slate-500">Irás al checkout para completar la compra.</p>
                </>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
