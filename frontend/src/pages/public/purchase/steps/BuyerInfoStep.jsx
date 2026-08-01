import { ChevronLeft } from "lucide-react";
import Card from "../../../../components/ui/Card.jsx";
import Button from "../../../../components/ui/Button.jsx";
import { Field, inputClass } from "../../../../components/ui/FormField.jsx";

const EMAIL_REGEX = /^\S+@\S+\.\S+$/;

// Único paso que pide datos del comprador — nunca una cuenta. El objetivo
// es que cualquier persona pueda comprar dejando sólo nombre/apellido/email
// de contacto (ahí van a llegar los QR más adelante).
export default function BuyerInfoStep({ buyer, onChange, onBack, onConfirm }) {
  const isValid = buyer.firstName.trim() && buyer.lastName.trim() && EMAIL_REGEX.test(buyer.email.trim());

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
