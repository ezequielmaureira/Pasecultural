import { useState } from "react";
import { ArrowRight } from "lucide-react";
import Button from "../../../../components/ui/Button.jsx";
import LocationPicker from "../../../../components/location/LocationPicker.jsx";
import { Field, inputClass } from "../../../../components/ui/FormField.jsx";
import { createEmptyLocation, hasCoordinates } from "../../../../lib/locationUtils.js";

// Adapta el shape de LocationPicker (venueName/formattedAddress/addressLine/...)
// al que espera backend/src/conversation/inputHandlers/location.js
// ({ address, city, province, latitude, longitude, venueName?, googlePlaceId? }).
// Es lo que resuelve LOCATION_MISSING_COORDINATES al publicar: LocationPicker
// ya obliga a elegir un punto en el mapa antes de tener latitude/longitude.
function toEngineLocation(location) {
  return {
    address: location.addressLine || location.formattedAddress,
    city: location.city,
    province: location.province,
    latitude: location.latitude,
    longitude: location.longitude,
    venueName: location.venueName || null,
    googlePlaceId: location.googlePlaceId || null,
  };
}

// Fallback sin mapa: se usa sólo si Google Maps no está disponible (ej. facturación
// todavía sin propagar en Google Cloud). No agrega un segundo proveedor de mapas
// -sigue siendo exclusivamente Google-, sólo permite tipear la dirección a mano
// sin coordenadas. El evento puede guardarse como borrador así, pero para
// publicar EventService va a seguir pidiendo coordenadas (regla ya existente,
// sin cambios) hasta que se vuelva a este paso con el mapa funcionando.
function ManualLocationForm({ location, onChange }) {
  return (
    <div className="flex w-full max-w-xl flex-col gap-4">
      <Field label="Nombre del lugar">
        <input
          className={inputClass}
          value={location.venueName}
          onChange={(e) => onChange({ ...location, venueName: e.target.value })}
          placeholder="Ej: Teatro del Libertador"
        />
      </Field>
      <Field label="Dirección *">
        <input
          className={inputClass}
          value={location.addressLine}
          onChange={(e) => onChange({ ...location, addressLine: e.target.value })}
          placeholder="Calle y número"
        />
      </Field>
      <Field label="Ciudad *">
        <input
          className={inputClass}
          value={location.city}
          onChange={(e) => onChange({ ...location, city: e.target.value })}
        />
      </Field>
      <Field label="Provincia *">
        <input
          className={inputClass}
          value={location.province}
          onChange={(e) => onChange({ ...location, province: e.target.value })}
        />
      </Field>
      <p className="text-xs text-amber-400">
        Cargada así, sin mapa, vas a poder guardar el evento como borrador pero no publicarlo
        hasta volver a este paso con el mapa disponible y confirmar la ubicación exacta.
      </p>
    </div>
  );
}

export default function LocationAnswer({ onSubmit, disabled }) {
  const [location, setLocation] = useState(createEmptyLocation());
  const [manualMode, setManualMode] = useState(false);

  const canSubmit = manualMode
    ? Boolean(location.addressLine && location.city && location.province)
    : hasCoordinates(location) && location.city && location.province;

  return (
    <div className="flex w-full flex-col items-center gap-4">
      <div className="w-full max-w-xl">
        {manualMode ? (
          <ManualLocationForm location={location} onChange={setLocation} />
        ) : (
          <LocationPicker value={location} onChange={setLocation} required />
        )}
      </div>

      <button
        type="button"
        onClick={() => setManualMode((prev) => !prev)}
        className="text-xs text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline"
      >
        {manualMode ? "Volver a usar el mapa" : "¿No ves el mapa? Cargar la dirección a mano"}
      </button>

      <Button disabled={disabled || !canSubmit} onClick={() => onSubmit(toEngineLocation(location))}>
        Continuar
        <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
