import { useEffect, useRef, useState } from "react";
import { MapPin, Navigation, AlertTriangle } from "lucide-react";
import { loadGoogleMaps } from "../../lib/googleMapsLoader.js";
import { hasCoordinates, buildGoogleMapsDirectionsUrl } from "../../lib/locationUtils.js";

// Componente de solo lectura: mapa + marcador + botón "Cómo llegar".
// Se reutiliza en la vista previa del wizard, el detalle interno y la
// página pública del evento. No comparte lógica con LocationPicker: acá
// no hay autocomplete, ni edición, ni eventos de arrastre por defecto.
export default function LocationMap({
  latitude,
  longitude,
  venueName,
  formattedAddress,
  interactive = false,
  className = "",
}) {
  const mapRef = useRef(null);
  const mapObjRef = useRef(null);
  const markerObjRef = useRef(null);
  const [status, setStatus] = useState("idle"); // idle | loading | ready | error
  const [errorMessage, setErrorMessage] = useState("");

  const located = hasCoordinates({ latitude, longitude });

  useEffect(() => {
    if (!located) return;
    let cancelled = false;
    setStatus("loading");

    loadGoogleMaps()
      .then((google) => {
        if (cancelled || !mapRef.current) return;

        const center = { lat: latitude, lng: longitude };

        if (!mapObjRef.current) {
          mapObjRef.current = new google.maps.Map(mapRef.current, {
            center,
            zoom: 16,
            disableDefaultUI: true,
            zoomControl: true,
            gestureHandling: interactive ? "auto" : "cooperative",
            styles: DARK_MAP_STYLE,
          });
        } else {
          mapObjRef.current.setCenter(center);
        }

        if (!markerObjRef.current) {
          markerObjRef.current = new google.maps.Marker({
            map: mapObjRef.current,
            position: center,
            draggable: false,
            title: venueName || undefined,
          });
        } else {
          markerObjRef.current.setPosition(center);
        }

        setStatus("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus("error");
        setErrorMessage(
          err?.name === "MissingGoogleMapsKeyError"
            ? "Falta configurar la clave de Google Maps para mostrar el mapa."
            : "No pudimos cargar el mapa de Google Maps en este momento."
        );
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [located, latitude, longitude]);

  if (!located) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 bg-white/5 p-6 text-center ${className}`}
      >
        <MapPin className="h-5 w-5 text-slate-500" />
        <p className="text-xs text-slate-500">Ubicación a confirmar</p>
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {(venueName || formattedAddress) && (
        <div className="flex flex-col gap-0.5">
          {venueName && <p className="text-sm font-semibold text-white">{venueName}</p>}
          {formattedAddress && <p className="text-xs text-slate-400">{formattedAddress}</p>}
        </div>
      )}

      <div
        ref={mapRef}
        className="h-56 w-full overflow-hidden rounded-xl border border-white/10 bg-white/5 sm:h-64"
      />

      {status === "error" && (
        <p className="flex items-center gap-1.5 text-xs text-rose-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {errorMessage}
        </p>
      )}

      <a
        href={buildGoogleMapsDirectionsUrl(latitude, longitude)}
        target="_blank"
        rel="noopener noreferrer"
        className="flex w-fit items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-xs font-medium text-white transition-colors duration-150 hover:bg-violet-500"
      >
        <Navigation className="h-3.5 w-3.5" />
        Cómo llegar
      </a>
    </div>
  );
}

const DARK_MAP_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#0B1120" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0B1120" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#94a3b8" }] },
  {
    featureType: "administrative",
    elementType: "geometry",
    stylers: [{ color: "#1e293b" }],
  },
  {
    featureType: "poi",
    elementType: "labels",
    stylers: [{ visibility: "off" }],
  },
  {
    featureType: "road",
    elementType: "geometry",
    stylers: [{ color: "#1e293b" }],
  },
  {
    featureType: "road",
    elementType: "labels.text.fill",
    stylers: [{ color: "#94a3b8" }],
  },
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ color: "#05070B" }],
  },
];
