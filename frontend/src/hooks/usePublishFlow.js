import { useState } from "react";

// Cuánto y cada cuánto reintentar confirmar el resultado real después de un
// timeout durante una publicación: 15 intentos cada 2s = hasta 30s extra de
// margen, sobre una operación que en el peor caso ya optimizado tarda unos
// 7-8s. No es un timeout más largo para el fetch original — es una segunda
// verificación, después, de qué pasó realmente.
const POLL_ATTEMPTS = 15;
const POLL_INTERVAL_MS = 2000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Estado y lógica compartida de "publicar algo que puede tardar": un
// spinner mientras se espera la respuesta y, si el fetch se cae por
// timeout, una segunda etapa que confirma el resultado real antes de
// asumir que falló. La usan tanto el wizard conversacional como el wizard
// clásico para que publicar un evento se sienta exactamente igual sin
// importar desde dónde se dispare.
//
// `publishing`/`setPublishing` quedan bajo control de quien llama (arranca
// y termina justo alrededor de su propio try/catch) porque cada flujo tiene
// su propia forma de disparar la publicación; `confirmAfterTimeout` es lo
// único que de verdad se comparte: reintentar `checkOutcome()` hasta que
// devuelva algo (el resultado real) o se acaben los intentos.
export function usePublishFlow() {
  const [publishing, setPublishing] = useState(false);
  const [checkingOutcome, setCheckingOutcome] = useState(false);

  async function confirmAfterTimeout(checkOutcome) {
    setCheckingOutcome(true);
    try {
      for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
        await sleep(POLL_INTERVAL_MS);
        let outcome;
        try {
          outcome = await checkOutcome();
        } catch {
          continue; // problema de red puntual en el chequeo: reintenta en la próxima vuelta
        }
        if (outcome) return outcome;
      }
      return null;
    } finally {
      setCheckingOutcome(false);
    }
  }

  return { publishing, setPublishing, checkingOutcome, confirmAfterTimeout };
}
