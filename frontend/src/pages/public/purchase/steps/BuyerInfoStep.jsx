import { useState } from "react";
import { ChevronLeft } from "lucide-react";
import Card from "../../../../components/ui/Card.jsx";
import Button from "../../../../components/ui/Button.jsx";
import { Field, inputClass } from "../../../../components/ui/FormField.jsx";

const EMAIL_REGEX = /^\S+@\S+\.\S+$/;
// Sólo dígitos (7 a 10) — el mismo rango que valida el backend
// (validateBuyerDocument.js). Se aplica sobre el valor ya normalizado, no
// sobre lo que el usuario ve/escribe con puntos o espacios.
const DOCUMENT_REGEX = /^\d{7,10}$/;

// El comprador puede escribir el DNI con el formato habitual en Argentina
// (con puntos, ej. "20.123.456") o con espacios/guiones — se limpia para
// validar y para lo que se manda al backend, que además normaliza de nuevo
// del lado servidor (nunca se confía sólo en esto).
function normalizeDocument(rawValue) {
  return rawValue.replace(/[\s.-]/g, "");
}

// Único paso que pide datos del comprador — nunca una cuenta. El objetivo
// es que cualquier persona pueda comprar dejando nombre/apellido/email de
// contacto (ahí van a llegar los QR más adelante) y su DNI, que hoy sólo se
// guarda como preparación para la futura recuperación segura de entradas
// (todavía no existe esa pantalla).
export default function BuyerInfoStep({ buyer, onChange, onBack, onConfirm }) {
  const [documentTouched, setDocumentTouched] = useState(false);

  const normalizedDocument = normalizeDocument(buyer.document || "");
  const isDocumentValid = DOCUMENT_REGEX.test(normalizedDocument);
  const showDocumentError = documentTouched && !isDocumentValid;

  const isValid =
    buyer.firstName.trim() &&
    buyer.lastName.trim() &&
    EMAIL_REGEX.test(buyer.email.trim()) &&
    isDocumentValid;

  function documentErrorMessage() {
    if (!normalizedDocument) return "Ingresá tu DNI para continuar.";
    if (!/^\d+$/.test(normalizedDocument)) return "El DNI sólo puede tener números.";
    return "El DNI tiene que tener entre 7 y 10 números.";
  }

  return (
    <Card>
      <div className="flex flex-col gap-1 pb-4 text-center">
        <h2 className="text-lg font-bold text-white">Datos del comprador</h2>
        <p className="text-sm text-slate-400">Tus entradas van a llegar a este email</p>
      </div>

      <div className="flex flex-col gap-4">
        <Field label="Nombre" required>
          <input
            className={inputClass}
            value={buyer.firstName}
            onChange={(e) => onChange({ ...buyer, firstName: e.target.value })}
            placeholder="Tu nombre"
            autoComplete="given-name"
          />
        </Field>
        <Field label="Apellido" required>
          <input
            className={inputClass}
            value={buyer.lastName}
            onChange={(e) => onChange({ ...buyer, lastName: e.target.value })}
            placeholder="Tu apellido"
            autoComplete="family-name"
          />
        </Field>
        <Field label="Email" required>
          <input
            type="email"
            className={inputClass}
            value={buyer.email}
            onChange={(e) => onChange({ ...buyer, email: e.target.value })}
            placeholder="tu@email.com"
            autoComplete="email"
          />
        </Field>
        <Field label="DNI" required>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            maxLength={12}
            className={`${inputClass} ${showDocumentError ? "border-rose-500/60 focus:border-rose-500 focus:ring-rose-500/20" : ""}`}
            value={buyer.document}
            onChange={(e) => {
              onChange({ ...buyer, document: e.target.value });
              if (e.target.value) setDocumentTouched(true);
            }}
            onBlur={() => setDocumentTouched(true)}
            placeholder="Tu DNI, sin puntos"
          />
          {showDocumentError && <p className="text-xs text-rose-400">{documentErrorMessage()}</p>}
        </Field>
      </div>

      <div className="mt-5 flex gap-3">
        <Button variant="secondary" onClick={onBack} className="flex-1 justify-center">
          <ChevronLeft className="h-4 w-4" />
          Volver
        </Button>
        <Button disabled={!isValid} onClick={onConfirm} className="flex-1 justify-center">
          Pagar
        </Button>
      </div>
    </Card>
  );
}
