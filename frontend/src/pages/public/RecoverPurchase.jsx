import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, CalendarDays, MapPin } from "lucide-react";
import Card from "../../components/ui/Card.jsx";
import Button from "../../components/ui/Button.jsx";
import Spinner from "../../components/ui/Spinner.jsx";
import { Field, inputClass } from "../../components/ui/FormField.jsx";
import { recoverSales } from "../../lib/saleApi.js";

const EMAIL_REGEX = /^\S+@\S+\.\S+$/;
const DOCUMENT_REGEX = /^\d{7,10}$/;

// Mismo criterio que BuyerInfoStep.jsx: el DNI se puede escribir con
// puntos/espacios/guiones, se limpia antes de validar y de mandar al
// backend (que además normaliza de nuevo del lado servidor).
function normalizeDocument(rawValue) {
  return rawValue.replace(/[\s.-]/g, "");
}

function formatFunctionDate(isoDate) {
  if (!isoDate) return "";
  try {
    return new Date(isoDate).toLocaleString("es-AR", { dateStyle: "long", timeStyle: "short" });
  } catch {
    return isoDate;
  }
}

// Pantalla pública "Recuperar mis entradas": busca por email + DNI exactos
// (nunca uno solo — ver recoverSalesService en el backend) y, apenas hay
// una compra encontrada, redirige a /comprar?saleToken=... — el MISMO
// camino de recuperación que ya usa PurchaseWizard después de una compra o
// recarga de página. No arma ninguna pantalla de tickets/QR/PDF propia:
// PurchaseWizard + SuccessStep ya hacen exactamente eso, reutilizados tal
// cual, sin duplicar nada.
export default function RecoverPurchase() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  // Nunca "document" a secas: taparía el `document` global del navegador.
  const [buyerDocument, setBuyerDocument] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [documentTouched, setDocumentTouched] = useState(false);

  // "form" | "loading" | "no-matches" | "multiple" | "error"
  const [status, setStatus] = useState("form");
  const [errorMessage, setErrorMessage] = useState("");
  const [matches, setMatches] = useState([]);

  const normalizedDocument = normalizeDocument(buyerDocument);
  const isEmailValid = EMAIL_REGEX.test(email.trim());
  const isDocumentValid = DOCUMENT_REGEX.test(normalizedDocument);
  const isValid = isEmailValid && isDocumentValid;

  async function handleSearch() {
    if (!isValid) return;
    setStatus("loading");
    setErrorMessage("");
    try {
      const results = await recoverSales({ email: email.trim(), buyerDocument: normalizedDocument });
      if (!results || results.length === 0) {
        setStatus("no-matches");
        return;
      }
      if (results.length === 1) {
        navigate(`/comprar?saleToken=${encodeURIComponent(results[0].recoveryToken)}`);
        return;
      }
      setMatches(results);
      setStatus("multiple");
    } catch (err) {
      setErrorMessage(err.message || "No pudimos buscar tu compra. Probá de nuevo en unos minutos.");
      setStatus("error");
    }
  }

  function handleTryAgain() {
    setStatus("form");
    setErrorMessage("");
    setMatches([]);
  }

  if (status === "loading") {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-slate-400">
        <Spinner size="lg" />
        <p className="text-sm">Buscando tu compra...</p>
      </div>
    );
  }

  if (status === "multiple") {
    return (
      <div className="mx-auto max-w-lg px-3 py-6 sm:px-4 sm:py-10">
        <Card>
          <div className="flex flex-col gap-1 pb-4 text-center">
            <h1 className="text-lg font-bold text-white">Encontramos {matches.length} compras</h1>
            <p className="text-sm text-slate-400">Elegí cuál querés ver</p>
          </div>
          <div className="flex flex-col gap-3">
            {matches.map((sale) => (
              <div
                key={sale.recoveryToken}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">{sale.eventTitle}</p>
                  <p className="flex items-center gap-1.5 truncate text-xs text-slate-400">
                    <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                    {formatFunctionDate(sale.functionDate)}
                  </p>
                  <p className="flex items-center gap-1.5 truncate text-xs text-slate-400">
                    <MapPin className="h-3.5 w-3.5 shrink-0" />
                    {sale.venue}
                  </p>
                </div>
                <Button
                  size="sm"
                  className="shrink-0"
                  onClick={() => navigate(`/comprar?saleToken=${encodeURIComponent(sale.recoveryToken)}`)}
                >
                  Ver entradas
                </Button>
              </div>
            ))}
          </div>
          <Button variant="secondary" onClick={handleTryAgain} className="mt-5 w-full justify-center">
            Buscar de nuevo
          </Button>
        </Card>
      </div>
    );
  }

  if (status === "no-matches") {
    return (
      <div className="mx-auto max-w-md px-3 py-10 sm:px-4 sm:py-16">
        <Card>
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <h1 className="text-lg font-bold text-white">No encontramos ninguna compra con esos datos.</h1>
            <p className="text-sm text-slate-400">
              Revisá que el email y el DNI sean exactamente los que usaste al comprar.
            </p>
            <Button onClick={handleTryAgain} className="mt-2 w-full justify-center">
              Intentar de nuevo
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-3 py-10 sm:px-4 sm:py-16">
      <Card>
        <div className="flex flex-col gap-1 pb-4 text-center">
          <h1 className="text-lg font-bold text-white">Recuperar mis entradas</h1>
          <p className="text-sm text-slate-400">Ingresá el email y el DNI que usaste al comprar</p>
        </div>

        <div className="flex flex-col gap-4">
          <Field label="Email" required>
            <input
              type="email"
              className={inputClass}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (e.target.value) setEmailTouched(true);
              }}
              onBlur={() => setEmailTouched(true)}
              placeholder="tu@email.com"
              autoComplete="email"
            />
            {emailTouched && !isEmailValid && <p className="text-xs text-rose-400">Ingresá un email válido.</p>}
          </Field>
          <Field label="DNI" required>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              maxLength={12}
              className={inputClass}
              value={buyerDocument}
              onChange={(e) => {
                setBuyerDocument(e.target.value);
                if (e.target.value) setDocumentTouched(true);
              }}
              onBlur={() => setDocumentTouched(true)}
              placeholder="Tu DNI, sin puntos"
            />
            {documentTouched && !isDocumentValid && (
              <p className="text-xs text-rose-400">El DNI tiene que tener entre 7 y 10 números.</p>
            )}
          </Field>

          {status === "error" && <p className="text-xs text-rose-400">{errorMessage}</p>}

          <Button disabled={!isValid} onClick={handleSearch} className="mt-1 w-full justify-center gap-1.5">
            <Search className="h-4 w-4" />
            Buscar mi compra
          </Button>
        </div>
      </Card>
    </div>
  );
}
