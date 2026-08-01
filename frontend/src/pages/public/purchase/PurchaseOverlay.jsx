import LoadingOverlay from "../../../components/ui/LoadingOverlay.jsx";

// Mismo mecanismo que PublishOverlay (publicar eventos): dos estados,
// "procesando" y "verificando" (post-timeout), mismo componente base
// (LoadingOverlay) — sólo cambia el texto para el contexto de compra.
export default function PurchaseOverlay({ open, checking }) {
  return (
    <LoadingOverlay
      open={open}
      title={checking ? "🔎 Verificando el pago..." : "🎟️ Confirmando tu compra..."}
      message={
        checking
          ? "La respuesta está tardando más de lo normal. Estamos verificando si tu compra ya se completó — no cierres esta pantalla."
          : "Estamos generando tus entradas. Esto puede tardar unos segundos."
      }
    />
  );
}
