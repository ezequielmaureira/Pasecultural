import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Field, inputClass } from "../ui/FormField.jsx";
import { loadGoogleMaps, MissingGoogleMapsKeyError } from "../../lib/googleMapsLoader.js";
import {
  DEFAULT_MAP_CENTER,
  DEFAULT_MAP_ZOOM,
  SELECTED_MAP_ZOOM,
  ARGENTINA_BOUNDS,
  hasCoordinates,
  locationFromPlace,
  locationFromGeocode,
} from "../../lib/locationUtils.js";

const DARK_MAP_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#0B1120" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0B1120" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#94a3b8" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#1e293b" }] },
  { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#1e293b" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#94a3b8" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#05070B" }] },
];

// Componente controlado: <LocationPicker value={location} onChange={setLocation} />.
// Busca direcciones con Google Places Autocomplete, muestra un mapa con un
// marcador draggable y devuelve siempre el objeto de ubicación completo.
// Toda la lógica de Google Maps vive acá adentro, no en el formulario del evento.
export default function LocationPicker({ value, onChange, required = false, error = "" }) {
  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const mapRef = useRef(null);
  const mapObjRef = useRef(null);
  const markerObjRef = useRef(null);
  const boundsRef = useRef(null);
  const autocompleteServiceRef = useRef(null);
  const placesServiceRef = useRef(null);
  const geocoderRef = useRef(null);
  const sessionTokenRef = useRef(null);
  const mapReadyRef = useRef(false);

  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  });

  const [searchText, setSearchText] = useState(value.formattedAddress || value.addressLine || "");
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [noResults, setNoResults] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [mapsStatus, setMapsStatus] = useState("loading"); // loading | ready | error
  const [mapsErrorMessage, setMapsErrorMessage] = useState("");

  // Mantiene el buscador sincronizado cuando `value` cambia desde afuera
  // (por ejemplo al terminar de cargar un evento existente para editar),
  // sin pisar lo que el usuario esté escribiendo en el medio.
  useEffect(() => {
    setSearchText(value.formattedAddress || value.addressLine || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.formattedAddress, value.addressLine]);

  function centerAndPlaceMarker(google, lat, lng, draggable = true) {
    if (lat === null || lat === undefined || lng === null || lng === undefined) return;
    const position = { lat, lng };

    if (!mapObjRef.current) return;
    mapObjRef.current.setCenter(position);
    mapObjRef.current.setZoom(SELECTED_MAP_ZOOM);

    if (!markerObjRef.current) {
      markerObjRef.current = new google.maps.Marker({
        map: mapObjRef.current,
        position,
        draggable,
      });
      markerObjRef.current.addListener("dragend", () => {
        const position2 = markerObjRef.current.getPosition();
        handlePositionChangeRef.current(position2.lat(), position2.lng());
      });
    } else {
      markerObjRef.current.setPosition(position);
    }
  }

  function handlePositionChange(lat, lng) {
    const google = window.google;
    if (!google) return;

    centerAndPlaceMarker(google, lat, lng);

    const optimistic = { ...valueRef.current, latitude: lat, longitude: lng };
    onChange(optimistic);

    if (!geocoderRef.current) return;
    geocoderRef.current.geocode({ location: { lat, lng } }, (results, status) => {
      if (status !== google.maps.GeocoderStatus.OK || !results?.[0]) {
        setMapsErrorMessage(
          "No pudimos actualizar la dirección automáticamente; verificala manualmente."
        );
        return;
      }
      setMapsErrorMessage("");
      const updated = locationFromGeocode(results[0], optimistic);
      setSearchText(updated.formattedAddress || updated.addressLine);
      onChange(updated);
    });
  }

  const handlePositionChangeRef = useRef(handlePositionChange);
  useEffect(() => {
    handlePositionChangeRef.current = handlePositionChange;
  });

  // Carga el script de Google Maps una sola vez y arma el mapa base.
  useEffect(() => {
    let cancelled = false;

    loadGoogleMaps()
      .then((google) => {
        if (cancelled || !mapRef.current) return;

        boundsRef.current = new google.maps.LatLngBounds(
          { lat: ARGENTINA_BOUNDS.south, lng: ARGENTINA_BOUNDS.west },
          { lat: ARGENTINA_BOUNDS.north, lng: ARGENTINA_BOUNDS.east }
        );

        const initialHasCoords = hasCoordinates(valueRef.current);
        const center = initialHasCoords
          ? { lat: valueRef.current.latitude, lng: valueRef.current.longitude }
          : DEFAULT_MAP_CENTER;

        mapObjRef.current = new google.maps.Map(mapRef.current, {
          center,
          zoom: initialHasCoords ? SELECTED_MAP_ZOOM : DEFAULT_MAP_ZOOM,
          disableDefaultUI: true,
          zoomControl: true,
          styles: DARK_MAP_STYLE,
        });

        mapObjRef.current.addListener("click", (e) => {
          handlePositionChangeRef.current(e.latLng.lat(), e.latLng.lng());
        });

        if (initialHasCoords) {
          centerAndPlaceMarker(google, valueRef.current.latitude, valueRef.current.longitude);
        }

        autocompleteServiceRef.current = new google.maps.places.AutocompleteService();
        placesServiceRef.current = new google.maps.places.PlacesService(mapObjRef.current);
        geocoderRef.current = new google.maps.Geocoder();
        sessionTokenRef.current = new google.maps.places.AutocompleteSessionToken();

        mapReadyRef.current = true;
        setMapsStatus("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        setMapsStatus("error");
        setMapsErrorMessage(
          err instanceof MissingGoogleMapsKeyError
            ? "Falta configurar la clave de Google Maps (VITE_GOOGLE_MAPS_API_KEY) para buscar direcciones y mostrar el mapa."
            : "No pudimos cargar Google Maps. Revisá tu conexión o la configuración de la API key."
        );
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Si la ubicación cambia desde afuera (carga de un evento existente) después
  // de que el mapa ya esté listo, recentramos y colocamos el marcador.
  useEffect(() => {
    if (!mapReadyRef.current || !window.google) return;
    if (!hasCoordinates(value)) return;
    centerAndPlaceMarker(window.google, value.latitude, value.longitude);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.latitude, value.longitude]);

  // Cierra las sugerencias al hacer clic fuera del componente.
  useEffect(() => {
    function handleDocumentClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleDocumentClick);
    return () => document.removeEventListener("mousedown", handleDocumentClick);
  }, []);

  // Autocomplete con debounce; evita pedidos innecesarios con texto muy corto.
  useEffect(() => {
    if (mapsStatus !== "ready") return;
    const trimmed = searchText.trim();

    if (trimmed.length < 3) {
      setSuggestions([]);
      setNoResults(false);
      return;
    }

    const timer = setTimeout(() => {
      autocompleteServiceRef.current?.getPlacePredictions(
        {
          input: trimmed,
          sessionToken: sessionTokenRef.current,
          locationBias: boundsRef.current,
        },
        (predictions, status) => {
          const google = window.google;
          if (status === google.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
            setSuggestions([]);
            setNoResults(true);
            return;
          }
          if (status !== google.maps.places.PlacesServiceStatus.OK || !predictions) {
            setSuggestions([]);
            setNoResults(false);
            setMapsErrorMessage(
              "No pudimos buscar direcciones en este momento (cuota o permisos de Google Maps)."
            );
            return;
          }
          setNoResults(false);
          setMapsErrorMessage("");
          setSuggestions(predictions);
          setShowSuggestions(true);
          setActiveIndex(-1);
        }
      );
    }, 300);

    return () => clearTimeout(timer);
  }, [searchText, mapsStatus]);

  function handlePlaceSelect(prediction) {
    if (!placesServiceRef.current) return;

    placesServiceRef.current.getDetails(
      {
        placeId: prediction.place_id,
        sessionToken: sessionTokenRef.current,
        fields: ["place_id", "formatted_address", "address_components", "geometry", "name"],
      },
      (place, status) => {
        const google = window.google;
        sessionTokenRef.current = new google.maps.places.AutocompleteSessionToken();

        if (status !== google.maps.places.PlacesServiceStatus.OK || !place) {
          setMapsErrorMessage(
            "No pudimos obtener el detalle de esa dirección. Probá con otra sugerencia."
          );
          return;
        }

        const nextLocation = locationFromPlace(place, valueRef.current.venueName);
        setSearchText(place.formatted_address || prediction.description);
        setSuggestions([]);
        setShowSuggestions(false);
        setActiveIndex(-1);
        setMapsErrorMessage("");
        onChange(nextLocation);

        if (mapObjRef.current && nextLocation.latitude !== null) {
          centerAndPlaceMarker(google, nextLocation.latitude, nextLocation.longitude);
        }
      }
    );
  }

  function handleSearchKeyDown(e) {
    if (!showSuggestions || suggestions.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const chosen = suggestions[activeIndex] ?? suggestions[0];
      if (chosen) handlePlaceSelect(chosen);
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  }

  const located = hasCoordinates(value);
  const showUnselectedHint = searchText.trim().length > 0 && !located && mapsStatus === "ready";

  return (
    <div ref={containerRef} className="flex flex-col gap-4">
      <Field label={`Nombre del lugar${required ? " *" : ""}`}>
        <input
          className={inputClass}
          value={value.venueName}
          onChange={(e) => onChange({ ...value, venueName: e.target.value })}
          placeholder="Ej: Teatro del Libertador"
        />
      </Field>

      <div className="relative flex flex-col gap-1.5">
        <span className="text-xs font-medium text-slate-400">
          Buscar dirección{required ? " *" : ""}
        </span>
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={showSuggestions}
          aria-autocomplete="list"
          className={inputClass}
          value={searchText}
          disabled={mapsStatus !== "ready"}
          onChange={(e) => {
            setSearchText(e.target.value);
            setShowSuggestions(true);
          }}
          onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
          onKeyDown={handleSearchKeyDown}
          placeholder="Escribí una dirección o el nombre de un lugar"
        />
        <p className="text-xs text-slate-500">
          Seleccioná una dirección de la lista para ubicar correctamente el evento.
        </p>
        {showUnselectedHint && (
          <p className="text-xs text-amber-400">
            Seleccioná una sugerencia de la lista para confirmar la ubicación.
          </p>
        )}

        {showSuggestions && suggestions.length > 0 && (
          <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-lg border border-white/10 bg-[#0B1120] shadow-xl">
            {suggestions.map((suggestion, index) => (
              <li key={suggestion.place_id}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handlePlaceSelect(suggestion)}
                  className={`block w-full truncate px-3 py-2 text-left text-sm transition-colors duration-100 ${
                    index === activeIndex
                      ? "bg-violet-600/20 text-white"
                      : "text-slate-300 hover:bg-white/5"
                  }`}
                >
                  {suggestion.description}
                </button>
              </li>
            ))}
          </ul>
        )}

        {showSuggestions && suggestions.length === 0 && noResults && (
          <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-lg border border-white/10 bg-[#0B1120] p-3 text-xs text-slate-500">
            No encontramos resultados. Probá con otra búsqueda.
          </div>
        )}
      </div>

      <div className="relative h-64 w-full overflow-hidden rounded-xl border border-white/10 bg-white/5 sm:h-80">
        {/* El div del mapa siempre está montado con su tamaño real: Google Maps
            necesita dimensiones reales en el momento de crearse, si no renderiza
            en negro/en blanco. Los estados de carga/error van encima, no en su lugar. */}
        <div ref={mapRef} className="h-full w-full" />

        {mapsStatus === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-[#0B1120] text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Cargando mapa...
          </div>
        )}

        {mapsStatus === "error" && (
          <div className="absolute inset-0 flex items-start gap-2 bg-[#0B1120] p-3 text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="text-xs">{mapsErrorMessage}</p>
          </div>
        )}
      </div>

      {mapsStatus === "ready" && mapsErrorMessage && (
        <p className="flex items-center gap-1.5 text-xs text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {mapsErrorMessage}
        </p>
      )}

      <div className="rounded-lg border border-white/10 bg-white/5 p-3">
        <p className="text-xs font-medium text-slate-400">Ubicación seleccionada</p>
        {located ? (
          <>
            <p className="text-sm text-white">{value.venueName || "Sin nombre"}</p>
            <p className="text-xs text-slate-400">{value.formattedAddress || value.addressLine}</p>
            {(value.city || value.province) && (
              <p className="text-xs text-slate-500">
                {[value.city, value.province].filter(Boolean).join(", ")}
              </p>
            )}
          </>
        ) : (
          <p className="text-xs text-slate-500">Todavía no seleccionaste una ubicación.</p>
        )}
      </div>

      {error && <p className="text-xs text-rose-400">{error}</p>}
    </div>
  );
}
