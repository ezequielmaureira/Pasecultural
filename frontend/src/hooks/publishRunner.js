// Núcleo sin React de usePublishFlow (ver usePublishFlow.js): recibe los
// setters de estado por parámetro para poder testearlo con node:test sin
// montar componentes ni cargar lib/api.js (import.meta.env).

const UNRESOLVED_MESSAGE =
  "No pudimos confirmar si se guardó. Revisá la lista de tus eventos antes de reintentar para no duplicarlo.";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createPublishRunner({ setPublishing, setCheckingOutcome, timeoutMs, pollAttempts, pollIntervalMs }) {
  async function confirmAfterTimeout(checkOutcome) {
    setCheckingOutcome(true);
    try {
      for (let attempt = 0; attempt < pollAttempts; attempt++) {
        await sleep(pollIntervalMs);
        let outcome;
        try {
          outcome = await checkOutcome();
        } catch (error) {
          console.error("usePublishFlow.confirmAfterTimeout checkOutcome error", error);
          console.error(error.response);
          console.error(error.data);
          console.error(error.stack);
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
  // unresolvedMessage(): opcional — el mensaje del error final si ni la
  // operación ni la confirmación por timeout resolvieron nada. Por default
  // el mensaje de "evento" (primer caso de uso del hook); otros llamadores
  // (ej. compra de entradas) pasan el suyo sin tener que duplicar `run()`.
  //
  // keepPublishingOnSuccess: opcional — si es true y `run()` resuelve, el
  // estado `publishing` queda en true: el llamador va a abandonar la página
  // (redirección a Mercado Pago) y apagar el overlay acá volvería a mostrar
  // el formulario durante el instante que tarda el navegador en salir. Si
  // el llamador al final NO navega, es responsable de llamar
  // setPublishing(false). En error se apaga siempre, como antes.
  //
  // Devuelve lo que resuelva `action()`. Si el timer propio gana la carrera
  // antes que `action()`, pasa a confirmar el resultado real: si lo
  // encuentra, resuelve igual (con `recovered: true`); si no, tira un error
  // `isTimeout` con el mensaje unificado para que el llamador lo muestre.
  async function run(action, { checkOutcome, unresolvedMessage = UNRESOLVED_MESSAGE, keepPublishingOnSuccess = false }) {
    setPublishing(true);
    let succeeded = false;
    try {
      let timeoutId;
      const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          const err = new Error("La operación está tardando más de lo esperado.");
          err.isTimeout = true;
          reject(err);
        }, timeoutMs);
      });

      try {
        const result = await Promise.race([action(), timeout]);
        succeeded = true;
        return result;
      } catch (err) {
        console.error("usePublishFlow.run caught error", err);
        console.error(err.response);
        console.error(err.data);
        console.error(err.stack);
        if (!err.isTimeout) throw err;

        const outcome = await confirmAfterTimeout(checkOutcome);
        if (outcome) {
          succeeded = true;
          return outcome;
        }

        const unresolvedError = new Error(unresolvedMessage);
        unresolvedError.isTimeout = true;
        unresolvedError.unresolved = true;
        throw unresolvedError;
      } finally {
        clearTimeout(timeoutId);
      }
    } finally {
      if (!(succeeded && keepPublishingOnSuccess)) setPublishing(false);
    }
  }

  return { confirmAfterTimeout, run };
}
