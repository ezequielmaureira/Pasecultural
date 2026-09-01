import { createContext, useContext, useMemo, useRef, useState, useCallback, useEffect } from "react";

// Organization Theme (público) — Navbar vive en PublicShell, un nivel por
// ENCIMA del <Outlet/> que renderiza OrganizationProfile/EventDetail/
// PurchaseWizard — no hay forma de pasarle props directo. Este Context,
// provisto una sola vez por PublicShell, existe para dos cosas:
//
//   1. `branding` — la Organization anuncia su identidad (slug/name/logo)
//      cuando `branding.enabled === true`. Autoridad exclusiva: el
//      backend. Nunca localStorage/sessionStorage/query params.
//
//   2. `isResolving` — cierre del flash "dark → fetch → light": mientras
//      una página dependiente de branding (Organization/Event/Checkout)
//      todavía no terminó SU fetch, declara "estoy resolviendo" acá. Sólo
//      esas 3 páginas llaman a `useRegisterPublicBrandingPending` — Home,
//      /eventos y cualquier otra ruta pública que nunca la invoque deja
//      `isResolving` en `false` para siempre, sin ninguna detección de
//      ruta ni ninguna espera nueva.
//
// `isResolving` se modela como CONTADOR (no booleano simple) para tolerar
// que, en teoría, más de una página dependiente pueda coexistir/solaparse
// durante una transición de ruta sin pisarse entre sí.
const PublicBrandingContext = createContext({
  branding: null,
  isResolving: false,
  registerBranding: () => {},
  registerResolving: () => undefined,
});

export function PublicBrandingProvider({ children }) {
  const [branding, setBranding] = useState(null);
  const [resolvingCount, setResolvingCount] = useState(0);

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

  // No usa el mismo patrón de "dueño" que registerBranding porque acá SÍ
  // queremos que cada declaración sea aditiva (contador), no que la última
  // gane — dos páginas pendientes en simultáneo deben mantener el bootstrap
  // hasta que AMBAS terminen, nunca que la segunda "pise" a la primera.
  const registerResolving = useCallback((isPending) => {
    if (!isPending) return undefined;
    setResolvingCount((count) => count + 1);
    return () => setResolvingCount((count) => count - 1);
  }, []);

  const value = useMemo(
    () => ({ branding, isResolving: resolvingCount > 0, registerBranding, registerResolving }),
    [branding, resolvingCount, registerBranding, registerResolving]
  );

  return <PublicBrandingContext.Provider value={value}>{children}</PublicBrandingContext.Provider>;
}

export function usePublicBranding() {
  return useContext(PublicBrandingContext).branding;
}

// Autoridad de "¿tenemos que mostrar el bootstrap neutro público?" — SÓLO
// true mientras al menos una página dependiente está resolviendo su
// branding. Nunca true por defecto (Home/otras rutas no la consultan).
export function usePublicBrandingResolving() {
  return useContext(PublicBrandingContext).isResolving;
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
  }, [registerBranding, brandingOrNull?.slug, brandingOrNull?.name, brandingOrNull?.logo]);
}

// Hook que usan las MISMAS 3 páginas para declarar "todavía no sé si esta
// Organization es Premium o no" mientras dura SU fetch (su propio estado
// `loading`, el que ya usan para su UI actual). Nunca inferido por ruta:
// es la propia página quien mejor sabe cuándo terminó de resolver — éxito,
// error o not-found, siempre termina (`loading` siempre cae a `false` en
// el `finally` de cada página), así que nunca queda un bootstrap infinito.
export function useRegisterPublicBrandingPending(isPending) {
  const { registerResolving } = useContext(PublicBrandingContext);

  useEffect(() => {
    return registerResolving(isPending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerResolving, isPending]);
}
