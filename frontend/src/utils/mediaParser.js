import { getEventLinkIcon } from "../lib/eventLinkTypes.js";

// MediaParser: toda la lógica de detección de URLs de "Enlaces del Evento"
// vive acá. Los componentes React (EventLinksEditor, MediaEmbed, SocialLinks)
// solo consumen el resultado de parseMediaUrl(), nunca vuelven a detectar nada.
//
// Preparado para sumar plataformas nuevas (Vimeo, Twitch, SoundCloud, Apple
// Music) agregando un detector más a DETECTORS, sin tocar el resto del módulo.

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
    if (embedMatch) return YOUTUBE_ID_REGEX.test(embedMatch[1]) ? embedMatch[1] : null;

    const shortsMatch = pathname.match(/^\/shorts\/([^/]+)/);
    if (shortsMatch) return YOUTUBE_ID_REGEX.test(shortsMatch[1]) ? shortsMatch[1] : null;
  }

  return null;
}

function base(platform) {
  return { platform, embedUrl: null, thumbnail: null, isEmbeddable: false };
}

// Cada detector recibe la URL ya parseada (WHATWG URL) y devuelve el
// resultado si reconoce la plataforma, o `null` si no le corresponde.
const DETECTORS = [
  {
    platform: "YOUTUBE",
    detect(parsedUrl) {
      if (!hostnameIncludes(parsedUrl.hostname, ["youtube.com", "youtu.be"])) return null;

      const videoId = extractYoutubeVideoId(parsedUrl);
      if (!videoId) {
        // Es un link de YouTube (canal, playlist, home) pero no un video
        // puntual: no hay nada embebible, lo tratamos como inválido.
        return { invalid: true, reason: "LINK_INVALID_VIDEO" };
      }

      return {
        ...base("YOUTUBE"),
        embedUrl: `https://www.youtube.com/embed/${videoId}`,
        // Google devuelve un placeholder 120x90 (no un 404) cuando
        // maxresdefault no existe; un consumidor que muestre esta imagen
        // debería hacer fallback a hqdefault si el thumbnail llega muy chico.
        thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
        isEmbeddable: true,
      };
    },
  },
  {
    platform: "INSTAGRAM",
    detect: (u) => (hostnameIncludes(u.hostname, ["instagram.com"]) ? base("INSTAGRAM") : null),
  },
  {
    platform: "FACEBOOK",
    detect: (u) =>
      hostnameIncludes(u.hostname, ["facebook.com", "fb.watch"]) ? base("FACEBOOK") : null,
  },
  {
    platform: "TIKTOK",
    detect: (u) => (hostnameIncludes(u.hostname, ["tiktok.com"]) ? base("TIKTOK") : null),
  },
  {
    platform: "SPOTIFY",
    detect: (u) => (hostnameIncludes(u.hostname, ["spotify.com"]) ? base("SPOTIFY") : null),
  },
  {
    platform: "WHATSAPP",
    detect: (u) =>
      hostnameIncludes(u.hostname, ["wa.me", "whatsapp.com"]) ? base("WHATSAPP") : null,
  },
];

export function isValidHttpUrl(value) {
  if (!value || typeof value !== "string") return false;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

// Devuelve { type, originalUrl, embedUrl, thumbnail, icon, platform, isEmbeddable }
// o `null` si la URL está vacía o no es una URL http(s) válida.
// Lanza un Error con message "LINK_INVALID_VIDEO" si es un link de YouTube
// sin un video puntual detectable (ese caso sí necesita un mensaje propio).
export function parseMediaUrl(url) {
  if (!url || !url.trim()) return null;
  const trimmed = url.trim();
  if (!isValidHttpUrl(trimmed)) return null;

  const parsedUrl = new URL(trimmed);
  let detected = base("OTHER");

  for (const detector of DETECTORS) {
    const result = detector.detect(parsedUrl);
    if (result) {
      if (result.invalid) {
        throw new Error(result.reason);
      }
      detected = result;
      break;
    }
  }

  return {
    type: detected.isEmbeddable ? "video" : "link",
    originalUrl: trimmed,
    embedUrl: detected.embedUrl,
    thumbnail: detected.thumbnail,
    icon: getEventLinkIcon(detected.platform),
    platform: detected.platform,
    isEmbeddable: detected.isEmbeddable,
  };
}
