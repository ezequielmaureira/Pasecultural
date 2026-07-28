// rawValue: { address, city, province, venueName?, latitude?, longitude?, googlePlaceId? }
// En Web, el ChannelAdapter arma este objeto a partir del Google Maps picker;
// en WhatsApp, a partir de texto libre o de una ubicación compartida.
export function parse(rawValue) {
    const value = rawValue && typeof rawValue === "object" ? rawValue : {};
    const address = typeof value.address === "string" ? value.address.trim() : "";
    const city = typeof value.city === "string" ? value.city.trim() : "";
    const province = typeof value.province === "string" ? value.province.trim() : "";

    if (!address || !city || !province) {
        return { error: "Necesito dirección, ciudad y provincia para la ubicación." };
    }

    return {
        value: {
            address,
            city,
            province,
            venueName: typeof value.venueName === "string" ? value.venueName.trim() || null : null,
            latitude: value.latitude === undefined || value.latitude === null ? null : Number(value.latitude),
            longitude: value.longitude === undefined || value.longitude === null ? null : Number(value.longitude),
            googlePlaceId: typeof value.googlePlaceId === "string" ? value.googlePlaceId.trim() || null : null,
        },
    };
}
