import LoadingOverlay from "./LoadingOverlay.jsx";

// Única fuente de verdad de cómo se ve "publicando" en toda la app — texto,
// spinner y los dos estados (publicando / confirmando) son exactamente los
// mismos sin importar si el disparador es el wizard conversacional o el
// clásico (ver hooks/usePublishFlow.js para la lógica que decide cuándo
// pasar de uno a otro).
export default function PublishOverlay({ open, checking }) {
  return (
    <LoadingOverlay
      open={open}
      title={checking ? "🔎 Confirmando..." : "🎭 Publicando tu evento..."}
      message={
        checking
          ? "La respuesta está tardando más de lo normal. Estamos confirmando si tu evento ya quedó guardado — no cierres esta pantalla."
          : "Estamos preparando tu evento para que aparezca en PaseCultural. Esto puede tardar unos segundos."
      }
    />
  );
}
