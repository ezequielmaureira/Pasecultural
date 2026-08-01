import { useState } from "react";
import { DEFAULT_TIMEOUT_MS } from "../lib/api.js";

// Cuánto y cada cuánto reintentar confirmar el resultado real después de un
// timeout durante una publicación: 15 intentos cada 2s = hasta 30s extra de
// margen, sobre una operación que en el peor caso ya optimizado tarda unos
// 7-8s. No es un timeout más largo para el fetch original — es una segunda
// verificación, después, de qué pasó realmente.
const POLL_ATTEMPTS = 15;
const POLL_INTERVAL_MS = 2000;

const UNRESOLVED_MESSAGE =
  "No pudimos confirmar si se guardó. Revisá la lista de tus eventos antes de reintentar para no duplicarlo.";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Estado y lógica compartida de "publicar algo que puede tardar": un
// spinner mientras se espera la respuesta y, si la operación se cae por
// timeout, una segunda etapa que confirma el resultado real antes de
// asumir que falló. La usan tanto el wizard conversacional como el wizard
// clásico para que publicar un evento se sienta exactamente igual sin
// importar desde dónde se dispare — ni en la UI ni en cuándo se dispara
// esa segunda etapa.
//
// `run()` es lo que de verdad unifica el trigger: en vez de que cada
// llamador confíe en el timeout individual de sus propios fetches (el chat
// hace 1 request, el wizard clásico hace varios, así que la misma
// DEFAULT_TIMEOUT_MS individual nunca se sentía igual de lejos), `run()`
// trata toda la operación —sin importar cuántos requests haga `action()``
// por dentro— como una sola unidad de tiempo con un único timer.
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

  // action(): la operación real (uno o varios fetches encadenados).
  // checkOutcome(): cómo confirmar, después de un timeout, si terminó igual.
  //
  // Devuelve lo que resuelva `action()`. Si el timer propio gana la carrera
  // antes que `action()`, pasa a confirmar el resultado real: si lo
  // encuentra, resuelve igual (con `recovered: true`); si no, tira un error
  // `isTimeout` con el mensaje unificado para que el llamador lo muestre.
  async function run(action, { checkOutcome }) {
    setPublishing(true);
    try {
      let timeoutId;
      const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          const err = new Error("La operación está tardando más de lo esperado.");
          err.isTimeout = true;
          reject(err);
        }, DEFAULT_TIMEOUT_MS);
      });

      try {
        const result = await Promise.race([action(), timeout]);
        return result;
      } catch (err) {
        if (!err.isTimeout) throw err;

        const outcome = await confirmAfterTimeout(checkOutcome);
        if (outcome) return outcome;

        const unresolvedError = new Error(UNRESOLVED_MESSAGE);
        unresolvedError.isTimeout = true;
        unresolvedError.unresolved = true;
        throw unresolvedError;
      } finally {
        clearTimeout(timeoutId);
      }
    } finally {
      setPublishing(false);
    }
  }

  return { publishing, setPublishing, checkingOutcome, confirmAfterTimeout, run };
}
