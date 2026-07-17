import { setOptions, importLibrary } from "@googlemaps/js-api-loader";

let loaderPromise = null;
let optionsWereSet = false;

export class MissingGoogleMapsKeyError extends Error {
  constructor() {
    super(
      "Falta configurar VITE_GOOGLE_MAPS_API_KEY en el archivo .env del frontend (ver .env.example)."
    );
    this.name = "MissingGoogleMapsKeyError";
  }
}

// Carga (una sola vez) el script de Google Maps JavaScript API con las
// librerías necesarias para el LocationPicker/LocationMap: "maps" (Map/Marker),
// "places" (autocomplete + detalle del lugar) y "geocoding" (reverse geocoding
// al mover el marcador). Usa la API funcional de @googlemaps/js-api-loader
// (setOptions/importLibrary); las clases quedan igual disponibles en
// window.google.maps.* como siempre.
export function loadGoogleMaps() {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    const error = new MissingGoogleMapsKeyError();
    console.error(error.message);
    return Promise.reject(error);
  }

  if (!loaderPromise) {
    if (!optionsWereSet) {
      setOptions({ key: apiKey, v: "weekly" });
      optionsWereSet = true;
    }

    loaderPromise = Promise.all([
      importLibrary("maps"),
      importLibrary("places"),
      importLibrary("geocoding"),
    ])
      .then(() => window.google)
      .catch((err) => {
        loaderPromise = null;
        console.error("No se pudo cargar Google Maps JavaScript API.", err);
        throw err;
      });
  }

  return loaderPromise;
}
