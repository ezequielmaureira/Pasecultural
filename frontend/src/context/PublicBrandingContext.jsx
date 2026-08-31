import { createContext, useContext, useMemo, useRef, useState, useCallback, useEffect } from "react";

// Organization Theme (público) — Premium Fase 2D.1. Navbar vive en
// PublicShell, un nivel por ENCIMA del <Outlet/> que renderiza
// OrganizationProfile/EventDetail/PurchaseWizard — no hay forma de pasarle
// props directo. Este Context, provisto una sola vez por PublicShell,
// existe únicamente para que esas páginas "anuncien" su branding hacia
// arriba. Alcance: sólo el subárbol de PublicShell. Nunca toca
// localStorage/sessionStorage/query params (ver instrucción explícita de
// la ronda) — es puramente memoria de React, se pierde al recargar, que es
// exactamente lo que queremos (la próxima carga la vuelve a anunciar la
// página que corresponda).
const PublicBrandingContext = createContext({
  branding: null,
  registerBranding: () => {},
});

export function PublicBrandingProvider({ children }) {
  const [branding, setBranding] = useState(null);

  // Un contador de "dueño" evita que una page que se está desmontando pise
  // con su cleanup (branding: null) el registro que ya hizo la page
  // siguiente que la reemplazó (ej: navegar de un evento de Cine Nadia a
  // otro evento de Cine Nadia sin pasar por un estado intermedio).
  const ownerRef = useRef(0);

  const registerBranding = useCallback((value) => {
    ownerRef.current += 1;
    const ownerId = ownerRef.current;
    setBranding(value);
    return () => {
      if (ownerRef.current === ownerId) setBranding(null);
    };
  }, []);

  const value = useMemo(() => ({ branding, registerBranding }), [branding, registerBranding]);

  return <PublicBrandingContext.Provider value={value}>{children}</PublicBrandingContext.Provider>;
}

export function usePublicBranding() {
  return useContext(PublicBrandingContext).branding;
}

// Hook que usan las páginas (OrganizationProfile/EventDetail/PurchaseWizard)
// para anunciar SU branding mientras están montadas. `null`/`undefined`
// limpia el anuncio (Organization sin CUSTOM_BRANDING, o todavía cargando).
export function useRegisterPublicBranding(brandingOrNull) {
  const { registerBranding } = useContext(PublicBrandingContext);

  useEffect(() => {
    if (!brandingOrNull) return undefined;
    return registerBranding(brandingOrNull);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    registerBranding,
    brandingOrNull?.slug,
    brandingOrNull?.name,
    brandingOrNull?.logo,
    brandingOrNull?.theme?.primary,
    brandingOrNull?.theme?.secondary,
  ]);
}
