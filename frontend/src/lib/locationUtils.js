// Centro aproximado de Argentina, usado como vista inicial del mapa cuando
// todavía no hay una ubicación seleccionada.
export const DEFAULT_MAP_CENTER = { lat: -38.4161, lng: -63.6167 };
export const DEFAULT_MAP_ZOOM = 4;
export const SELECTED_MAP_ZOOM = 16;

// Sesgo (no restricción dura) de las búsquedas de Autocomplete hacia
// Argentina, sin bloquear resultados internacionales válidos.
export const ARGENTINA_BOUNDS = {
  south: -55.1,
  west: -73.6,
  north: -21.8,
  east: -53.6,
};

export function createEmptyLocation() {
  return {
    venueName: "",
    formattedAddress: "",
    addressLine: "",
    city: "",
    province: "",
    country: "",
    postalCode: "",
    latitude: null,
    longitude: null,
    googlePlaceId: "",
  };
}

export function hasCoordinates(location) {
  return (
    typeof location?.latitude === "number" &&
    typeof location?.longitude === "number" &&
    !Number.isNaN(location.latitude) &&
    !Number.isNaN(location.longitude)
  );
}

function findComponent(components, type) {
  return components.find((component) => component.types.includes(type));
}

// Mapea los address_components de Google a nuestro objeto de ubicación.
// Contempla que en Argentina la localidad puede venir en distintos tipos
// según la zona (CABA, GBA, interior).
export function parseAddressComponents(components = []) {
  const streetNumber = findComponent(components, "street_number")?.long_name || "";
  const route = findComponent(components, "route")?.long_name || "";

  const locality =
    findComponent(components, "locality")?.long_name ||
    findComponent(components, "administrative_area_level_2")?.long_name ||
    findComponent(components, "postal_town")?.long_name ||
    findComponent(components, "sublocality")?.long_name ||
    findComponent(components, "sublocality_level_1")?.long_name ||
    "";

  const province = findComponent(components, "administrative_area_level_1")?.long_name || "";
  const country = findComponent(components, "country")?.long_name || "";
  const postalCode = findComponent(components, "postal_code")?.long_name || "";
  const addressLine = [route, streetNumber].filter(Boolean).join(" ");

  return { addressLine, city: locality, province, country, postalCode };
}

// Construye el objeto de ubicación completo a partir de un google.maps.places.PlaceResult
// (resultado de Place Details tras seleccionar una sugerencia del autocomplete).
export function locationFromPlace(place, previousVenueName) {
  const parsed = parseAddressComponents(place.address_components || []);
  const geometryLocation = place.geometry?.location;

  return {
    venueName: previousVenueName?.trim() || place.name || "",
    formattedAddress: place.formatted_address || "",
    addressLine: parsed.addressLine || place.formatted_address || "",
    city: parsed.city,
    province: parsed.province,
    country: parsed.country,
    postalCode: parsed.postalCode,
    latitude: geometryLocation ? geometryLocation.lat() : null,
    longitude: geometryLocation ? geometryLocation.lng() : null,
    googlePlaceId: place.place_id || "",
  };
}

// Construye el objeto de ubicación a partir de un resultado de reverse geocoding
// (arrastre del marcador). El nombre del lugar se mantiene: mover el pin no
// debería renombrar lo que el organizador ya escribió.
export function locationFromGeocode(result, previousLocation) {
  const parsed = parseAddressComponents(result.address_components || []);
  const geometryLocation = result.geometry?.location;

  return {
    ...previousLocation,
    formattedAddress: result.formatted_address || previousLocation.formattedAddress,
    addressLine: parsed.addressLine || result.formatted_address || previousLocation.addressLine,
    city: parsed.city || previousLocation.city,
    province: parsed.province || previousLocation.province,
    country: parsed.country || previousLocation.country,
    postalCode: parsed.postalCode || previousLocation.postalCode,
    latitude: geometryLocation ? geometryLocation.lat() : previousLocation.latitude,
    longitude: geometryLocation ? geometryLocation.lng() : previousLocation.longitude,
    googlePlaceId: result.place_id || previousLocation.googlePlaceId,
  };
}

export function buildGoogleMapsDirectionsUrl(latitude, longitude) {
  return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
}
