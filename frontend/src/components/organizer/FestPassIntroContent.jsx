import { useEffect, useState } from "react";
import FestPassIntro from "./FestPassIntro.jsx";
import { getPublicFestPassIntroContent } from "../../lib/contentApi.js";

// Wrapper de FestPassIntro.jsx — decide si mostrar la imagen configurable
// desde Developer > Contenido (ver DeveloperContent.jsx) o el bloque
// explicativo actual como fallback. Nunca deja un espacio vacío: mientras
// carga, si la card está inactiva/no existe, o si el request falla, se
// muestra siempre FestPassIntro sin cambios.
export default function FestPassIntroContent() {
  const [content, setContent] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getPublicFestPassIntroContent()
      .then((data) => {
        if (!cancelled) setContent(data);
      })
      .catch((err) => {
        console.error("No se pudo cargar la introducción configurada de Fest Pass", err);
        if (!cancelled) setContent({ active: false, imageUrl: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (content?.active && content.imageUrl) {
    return (
      <img
        src={content.imageUrl}
        alt="Fest Pass"
        className="w-full h-auto rounded-2xl object-contain"
      />
    );
  }

  return <FestPassIntro />;
}
