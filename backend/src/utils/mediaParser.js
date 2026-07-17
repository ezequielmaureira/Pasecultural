// MediaParser (backend): detecta la plataforma de una URL y, para las
// plataformas embebibles (por ahora solo YouTube), calcula embedUrl/thumbnail.
// Es un espejo minimalista del MediaParser del frontend (frontend/src/utils/mediaParser.js):
// el frontend lo usa para dar feedback instantáneo mientras el organizador pega
// la URL, y el backend vuelve a calcularlo acá como fuente de verdad antes de
// guardar (no confiamos únicamente en lo que mande el cliente).
//
// Preparado para extender a futuro con Vimeo, Twitch, SoundCloud, Apple Music:
// alcanza con agregar un detector más a `DETECTORS` sin tocar el resto del módulo.

const YOUTUBE_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;

function hostnameIncludes(hostname, needles) {
    return needles.some((needle) => hostname === needle || hostname.endsWith(`.${needle}`));
}

function extractYoutubeVideoId(parsedUrl) {
    const { hostname, pathname, searchParams } = parsedUrl;

    if (hostnameIncludes(hostname, ["youtu.be"])) {
        const id = pathname.slice(1).split("/")[0];
        return YOUTUBE_ID_REGEX.test(id) ? id : null;
    }

    if (hostnameIncludes(hostname, ["youtube.com"])) {
        if (pathname === "/watch") {
            const id = searchParams.get("v");
            return id && YOUTUBE_ID_REGEX.test(id) ? id : null;
        }
        const embedMatch = pathname.match(/^\/embed\/([^/]+)/);
        if (embedMatch) {
            return YOUTUBE_ID_REGEX.test(embedMatch[1]) ? embedMatch[1] : null;
        }
        const shortsMatch = pathname.match(/^\/shorts\/([^/]+)/);
        if (shortsMatch) {
            return YOUTUBE_ID_REGEX.test(shortsMatch[1]) ? shortsMatch[1] : null;
        }
    }

    return null;
}

// Cada detector recibe la URL ya parseada (WHATWG URL) y devuelve el resultado
// si reconoce la plataforma, o `null` si no le corresponde.
const DETECTORS = [
    {
        platform: "YOUTUBE",
        detect(parsedUrl) {
            if (!hostnameIncludes(parsedUrl.hostname, ["youtube.com", "youtu.be"])) return null;

            const videoId = extractYoutubeVideoId(parsedUrl);
            if (!videoId) {
                // Es un link de YouTube pero no pudimos extraer un video ID válido
                // (playlist, canal, home, o un ID mal formado): lo tratamos como
                // "video inexistente" para no guardar un embed roto.
                throw new Error("LINK_INVALID_VIDEO");
            }

            return {
                platform: "YOUTUBE",
                embedUrl: `https://www.youtube.com/embed/${videoId}`,
                // Google devuelve un placeholder 120x90 (no un 404) cuando
                // maxresdefault no existe; hqdefault siempre existe.
                thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
                isEmbeddable: true,
            };
        },
    },
    {
        platform: "INSTAGRAM",
        detect: (parsedUrl) => (hostnameIncludes(parsedUrl.hostname, ["instagram.com"]) ? base("INSTAGRAM") : null),
    },
    {
        platform: "FACEBOOK",
        detect: (parsedUrl) =>
            hostnameIncludes(parsedUrl.hostname, ["facebook.com", "fb.watch"]) ? base("FACEBOOK") : null,
    },
    {
        platform: "TIKTOK",
        detect: (parsedUrl) => (hostnameIncludes(parsedUrl.hostname, ["tiktok.com"]) ? base("TIKTOK") : null),
    },
    {
        platform: "SPOTIFY",
        detect: (parsedUrl) => (hostnameIncludes(parsedUrl.hostname, ["spotify.com"]) ? base("SPOTIFY") : null),
    },
    {
        platform: "WHATSAPP",
        detect: (parsedUrl) =>
            hostnameIncludes(parsedUrl.hostname, ["wa.me", "whatsapp.com"]) ? base("WHATSAPP") : null,
    },
];

function base(platform) {
    return { platform, embedUrl: null, thumbnail: null, isEmbeddable: false };
}

export function isValidHttpUrl(value) {
    if (!value || typeof value !== "string") return false;
    try {
        const parsed = new URL(value.trim());
        return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
        return false;
    }
}

// Devuelve { platform, embedUrl, thumbnail, isEmbeddable } o lanza
// Error("LINK_INVALID_VIDEO") si es una URL de YouTube sin un video válido.
// El llamador es responsable de validar antes que la URL sea http(s) válida.
export function parseMediaUrl(url) {
    const parsedUrl = new URL(url.trim());

    for (const detector of DETECTORS) {
        const result = detector.detect(parsedUrl);
        if (result) return result;
    }

    return base("OTHER");
}
