// rawValue: { address, city, province, venueName?, latitude?, longitude?, googlePlaceId? }
// En Web, el ChannelAdapter arma este objeto a partir del Google Maps picker
// (o del formulario manual sin mapa, ver LocationAnswer.jsx#ManualLocationForm
// — dirección/ciudad/provincia sin coordenadas, ya soportado de antes); en
// WhatsApp, a partir de una ubicación nativa compartida (lat/lng, ver
// whatsappOrganizerBot.service.js#buildLocationInputFromWhatsapp) — WhatsApp
// nunca entrega ciudad/provincia por separado, sólo coordenadas y,
// opcionalmente, nombre/dirección de un lugar buscado.
//
// Válido = dirección escrita completa (address+city+province, el camino Web
// de siempre) O coordenadas reales (el camino WhatsApp nuevo) — nunca texto
// libre a secas, nunca sólo un nombre sin nada más verificable. Un mismo
// evento puede seguir sin ciudad/provincia hasta que el organizador las
// complete desde la Web (igual que ya podía quedar sin coordenadas en el
// modo manual): eso no bloquea seguir el flujo, sólo publicar
// (assertPublishable, event.service.js, sin cambios).
export function parse(rawValue) {
    const value = rawValue && typeof rawValue === "object" ? rawValue : {};
    const address = typeof value.address === "string" ? value.address.trim() : "";
    const city = typeof value.city === "string" ? value.city.trim() : "";
    const province = typeof value.province === "string" ? value.province.trim() : "";
    const latitude = value.latitude === undefined || value.latitude === null || value.latitude === "" ? null : Number(value.latitude);
    const longitude = value.longitude === undefined || value.longitude === null || value.longitude === "" ? null : Number(value.longitude);

    const hasWrittenAddress = Boolean(address && city && province);
    const hasCoordinates = typeof latitude === "number" && !Number.isNaN(latitude) && typeof longitude === "number" && !Number.isNaN(longitude);

    if (!hasWrittenAddress && !hasCoordinates) {
        return { error: "Necesito dirección, ciudad y provincia (o una ubicación compartida) para la ubicación." };
    }

    return {
        value: {
            address: address || null,
            city: city || null,
            province: province || null,
            venueName: typeof value.venueName === "string" ? value.venueName.trim() || null : null,
            latitude,
            longitude,
            googlePlaceId: typeof value.googlePlaceId === "string" ? value.googlePlaceId.trim() || null : null,
        },
    };
}
