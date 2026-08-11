// Fase 3J — geocodificación server-side, independiente de cualquier canal.
// NO conoce WhatsApp, Web, EventCreationEngine ni Prisma: sólo sabe "dado un
// texto de dirección, buscar coordenadas reales" (geocodeAddress) y "dada
// una ubicación ya armada, decidir si hace falta geocodificarla y con qué
// resultado quedarse" (geocodeLocationIfNeeded) — este segundo export es el
// único punto que event.service.js necesita llamar, así la lógica de
// "cuándo sí/cuándo no" es reutilizable y testeable acá mismo, sin exponer
// nada nuevo desde event.service.js.
//
// BEST-EFFORT SIEMPRE: ninguna de las dos funciones lanza nunca. Si Google
// no responde, hay timeout, no hay resultados, la API devuelve error, o
// falta la API key, el resultado es "no hay coordenadas" — nunca bloquea
// crear/editar/publicar un evento (ver informe de entrega, sección "Fallo
// del geocoder").

const GEOCODING_TIMEOUT_MS = 5000;
const DEFAULT_COUNTRY = "Argentina";

// Mismo patrón LAZY que whatsapp.service.js (getWhatsappAccessToken, etc.):
// a diferencia de esas, ACÁ nunca se lanza si falta — geocodificar es
// opcional por naturaleza, no un requisito de configuración duro. Se cachea
// sólo el valor encontrado (nunca se cachea "no está", por si el proceso
// sigue vivo y la variable se agrega/corrige más adelante en el mismo
// deploy — costo despreciable, sólo una lectura de process.env de más).
let cachedApiKey;
function getGoogleMapsServerApiKey() {
    if (cachedApiKey) return cachedApiKey;
    const value = process.env.GOOGLE_MAPS_SERVER_API_KEY;
    if (!value || !value.trim()) return null;
    cachedApiKey = value.trim();
    return cachedApiKey;
}

function buildQueryAddress({ address, city, province, country }) {
    return [address, city, province, country || DEFAULT_COUNTRY]
        .filter((part) => typeof part === "string" && part.trim())
        .join(", ");
}

// Único punto que efectivamente llama a Google — la API REST oficial
// (Geocoding API), sin SDK: una sola llamada HTTP simple no lo justifica.
// Nunca se loguea la API key ni la dirección completa (podría incluir datos
// del organizador) fuera de este módulo.
async function requestGeocode(queryAddress, apiKey) {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(queryAddress)}&key=${apiKey}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), GEOCODING_TIMEOUT_MS);

    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) return null;

        const payload = await response.json();
        // "OK" es el único status que trae resultados usables — cualquier
        // otro (ZERO_RESULTS, OVER_QUERY_LIMIT, REQUEST_DENIED,
        // INVALID_REQUEST, UNKNOWN_ERROR) se trata igual: sin resultado.
        if (payload?.status !== "OK" || !Array.isArray(payload.results) || payload.results.length === 0) {
            return null;
        }

        const [result] = payload.results;
        const location = result?.geometry?.location;
        if (typeof location?.lat !== "number" || typeof location?.lng !== "number") return null;

        return {
            latitude: location.lat,
            longitude: location.lng,
            formattedAddress: typeof result.formatted_address === "string" ? result.formatted_address : null,
            googlePlaceId: typeof result.place_id === "string" ? result.place_id : null,
        };
    } catch {
        // Timeout (AbortError), error de red, o JSON inválido — todos caen acá.
        return null;
    } finally {
        clearTimeout(timeoutId);
    }
}

// address/city/province ya vienen validados por el caller (nunca se inventa
// ninguno de los tres acá) — country es opcional, cae a "Argentina" si no
// se informa (nunca se inventa una ciudad/provincia, sólo el país, que el
// pedido explícitamente autoriza como default). Devuelve `null` ante
// CUALQUIER motivo de fallo, incluida la falta de API key — nunca lanza.
export async function geocodeAddress({ address, city, province, country } = {}) {
    if (!address || !city || !province) return null;

    const apiKey = getGoogleMapsServerApiKey();
    if (!apiKey) return null;

    const queryAddress = buildQueryAddress({ address, city, province, country });
    return requestGeocode(queryAddress, apiKey);
}

// Orquesta la decisión completa que necesita event.service.js#buildLocationData:
//   - si YA hay coordenadas reales (compartidas desde WhatsApp, o elegidas
//     con el picker de Google Maps en la Web), se devuelven TAL CUAL, nunca
//     se geocodifica de nuevo (nunca se pisa un dato mejor que el que ya
//     había — sección "ubicaciones que ya tienen coordenadas" del pedido);
//   - si faltan address/city/province, tampoco se geocodifica (nunca se
//     inventa ninguno de los tres);
//   - si geocodeAddress no devuelve resultado (por cualquier motivo), las
//     coordenadas quedan en null — comportamiento actual, sin cambios.
// SIEMPRE devuelve {latitude, longitude, googlePlaceId} (nunca undefined,
// nunca lanza) — `googlePlaceId` conserva el que ya hubiera antes que el
// que devuelva Google, para no pisar un dato que el organizador ya tenía.
export async function geocodeLocationIfNeeded({ latitude = null, longitude = null, address, city, province, country, googlePlaceId = null } = {}) {
    if (latitude !== null && latitude !== undefined && longitude !== null && longitude !== undefined) {
        return { latitude, longitude, googlePlaceId };
    }

    if (!address || !city || !province) {
        return { latitude: null, longitude: null, googlePlaceId };
    }

    const geocoded = await geocodeAddress({ address, city, province, country });
    if (!geocoded) {
        return { latitude: null, longitude: null, googlePlaceId };
    }

    return {
        latitude: geocoded.latitude,
        longitude: geocoded.longitude,
        googlePlaceId: googlePlaceId ?? geocoded.googlePlaceId ?? null,
    };
}
