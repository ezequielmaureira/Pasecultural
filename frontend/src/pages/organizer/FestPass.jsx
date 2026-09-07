import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { Zap, Plus, Trash2, ExternalLink, ArrowLeft, PartyPopper, ShieldAlert, CalendarDays } from "lucide-react";
import Card from "../../components/ui/Card.jsx";
import Button from "../../components/ui/Button.jsx";
import LinkButton from "../../components/ui/LinkButton.jsx";
import ShareLinkPanel from "../../components/organizer/ShareLinkPanel.jsx";
import { Field, inputClass, textareaClass } from "../../components/ui/FormField.jsx";
import ImageUploader from "../../components/ui/ImageUploader.jsx";
import TimePicker from "../../components/ui/TimePicker.jsx";
import LocationPicker from "../../components/location/LocationPicker.jsx";
import { createEmptyLocation, hasCoordinates } from "../../lib/locationUtils.js";
import { apiFetch } from "../../lib/api.js";
import { useToast } from "../../context/ToastContext.jsx";
import { usePublishFlow } from "../../hooks/usePublishFlow.js";
import { canPublishEvents } from "../../lib/organizationTrust.js";
import { EVENT_CATEGORIES } from "../../lib/eventCategories.js";
import { createEmptyTicketType, createDefaultAssignment, toDateTime, currency } from "./eventWizard/model.js";

// Fest Pass — creador RÁPIDO de eventos (2 pantallas), pensado para
// fiestas/boliches/recitales chicos. NO es un sistema paralelo: arma
// exactamente el mismo Event/EventFunction/TicketType que ya crea
// OrganizerEventWizard.jsx, llamando a los MISMOS endpoints REST
// (POST /api/events, PUT /api/events/:id/schedule, PATCH /api/events/:id)
// que ya usa createEventService/syncEventScheduleService/updateMyEventService
// — el mismo dominio que también usa EventServicePort.commit() (WhatsApp).
// Quick Pass reutiliza los campos reales (quickPassEnabled/quickPassImageUrl)
// y su invariante de backend (assertQuickPassInvariant) — nunca se duplica
// nada acá, sólo se ofrece una UI más corta para llegar al mismo resultado.

function ErrorText({ message }) {
  if (!message) return null;
  return <p className="mt-1 text-xs text-rose-400">{message}</p>;
}

function HelpText({ children }) {
  return <p className="text-xs leading-relaxed text-slate-500">{children}</p>;
}

function createEmptyGeneral() {
  return {
    title: "",
    coverImage: "",
    category: EVENT_CATEGORIES[0].id,
    customCategory: "",
    description: "",
    quickPassEnabled: false,
    quickPassImageUrl: "",
  };
}

function ScreenShell({ children }) {
  return <div className="mx-auto flex w-full max-w-md flex-col gap-5 pb-10">{children}</div>;
}

export default function FestPass() {
  const navigate = useNavigate();
  const { getToken } = useAuth();
  const toast = useToast();
  const { run } = usePublishFlow();
  const eventIdRef = useRef(null);

  const [screen, setScreen] = useState("info"); // info | tickets | success
  const [general, setGeneral] = useState(createEmptyGeneral);
  const [location, setLocation] = useState(createEmptyLocation);
  const [locationError, setLocationError] = useState("");
  const [functionDate, setFunctionDate] = useState("");
  const [functionTime, setFunctionTime] = useState("21:00");
  const [admissionType, setAdmissionType] = useState("TICKETED");
  const [catalog, setCatalog] = useState(() => [createEmptyTicketType()]);
  const [quickPassAspectWarning, setQuickPassAspectWarning] = useState(false);
  const [organization, setOrganization] = useState(null);
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState("");
  const [saving, setSaving] = useState(false);
  const [published, setPublished] = useState(null); // { slug, quickPassEnabled }

  const isFreeEntry = admissionType === "FREE_ENTRY";
  const canPublish = canPublishEvents(organization);

  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        const { organization: org } = await apiFetch("/api/organizations/me", { token });
        setOrganization(org);
      } catch {
        // Best-effort: si falla, canPublishEvents(null) da false y el botón
        // de publicar queda deshabilitado con el mismo aviso que el resto
        // del panel — nunca se rompe la pantalla por esto.
      }
    })();
  }, [getToken]);

  // Mismo mecanismo exacto que usa OrganizerEventWizard para la imagen de
  // Quick Pass — sólo warning, nunca bloqueo (ver assertQuickPassInvariant
  // para el único bloqueo real, del lado del backend).
  useEffect(() => {
    if (!general.quickPassImageUrl) {
      setQuickPassAspectWarning(false);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      setQuickPassAspectWarning(img.naturalWidth / img.naturalHeight >= 0.9);
    };
    img.src = general.quickPassImageUrl;
    return () => {
      cancelled = true;
    };
  }, [general.quickPassImageUrl]);

  function setGeneralField(key, value) {
    setGeneral((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  function validateInfoScreen() {
    const nextErrors = {};
    if (!general.title.trim()) nextErrors.title = "El nombre del evento es obligatorio";
    if (general.category === "OTRO" && !general.customCategory.trim()) {
      nextErrors.customCategory = "Especificá el nombre de la categoría";
    }
    if (!functionDate) nextErrors.functionDate = "Elegí una fecha";

    const hasVenueName = Boolean(location.venueName.trim());
    const hasAddress = Boolean(location.formattedAddress.trim() || location.addressLine.trim());
    if (!hasVenueName || !hasAddress || !hasCoordinates(location)) {
      setLocationError(
        "Buscá la dirección y elegí una sugerencia de la lista para fijar el lugar en el mapa."
      );
      nextErrors.location = true;
    } else {
      setLocationError("");
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  function handleContinue() {
    if (!validateInfoScreen()) return;
    setScreen("tickets");
  }

  function addTicketType() {
    setCatalog((prev) => [...prev, createEmptyTicketType()]);
  }

  function removeTicketType(key) {
    setCatalog((prev) => (prev.length > 1 ? prev.filter((tt) => tt._key !== key) : prev));
  }

  function updateTicketType(key, field, value) {
    setCatalog((prev) => prev.map((tt) => (tt._key === key ? { ...tt, [field]: value } : tt)));
  }

  function validTicketTypes() {
    return catalog.filter((tt) => tt.name.trim() && tt.price !== "" && tt.quantity !== "");
  }

  function validateQuickPass() {
    if (general.quickPassEnabled && !general.quickPassImageUrl) {
      setErrors((prev) => ({ ...prev, quickPassImageUrl: "Subí una imagen para activar Quick Pass" }));
      return false;
    }
    setErrors((prev) => ({ ...prev, quickPassImageUrl: undefined }));
    return true;
  }

  function validateTicketsScreen() {
    if (isFreeEntry) return true;
    if (validTicketTypes().length === 0) {
      setSubmitError("Agregá al menos un tipo de entrada con nombre, precio y cantidad.");
      return false;
    }
    return true;
  }

  // Mismo shape exacto que buildGeneralPayload/buildSchedulePayload de
  // OrganizerEventWizard.jsx — reutiliza los mismos campos reales del
  // dominio Event, nunca inventa uno propio.
  function buildEventPayload() {
    return {
      title: general.title,
      coverImage: general.coverImage || null,
      category: general.category,
      customCategory: general.category === "OTRO" ? general.customCategory : null,
      description: general.description,
      admissionType,
      location,
      quickPassEnabled: general.quickPassEnabled,
      quickPassImageUrl: general.quickPassImageUrl || null,
    };
  }

  function buildSchedulePayload() {
    const types = isFreeEntry ? [] : validTicketTypes();
    return {
      ticketTypes: types.map((tt) => ({
        name: tt.name,
        price: Number(tt.price),
        quantity: Number(tt.quantity),
        maxPerPurchase: 10,
        description: null,
        visible: true,
      })),
      functions: [
        {
          date: toDateTime(functionDate, functionTime),
          doorsOpenAt: null,
          endAt: null,
          venue: location.venueName,
          address: location.addressLine || location.formattedAddress || null,
          capacity: null,
          status: "SCHEDULED",
          // Una sola función, catálogo completo asignado sin overrides — la
          // capacidad efectiva de cada TicketType es su propio `quantity`
          // (mismo criterio que effectiveCapacity, functionCapacity.service.js).
          ticketAssignments: types.map(() => createDefaultAssignment()),
        },
      ],
    };
  }

  async function persistEvent() {
    const token = await getToken();
    const { event } = await apiFetch("/api/events", {
      token,
      method: "POST",
      body: JSON.stringify(buildEventPayload()),
    });
    eventIdRef.current = event.id;
    await apiFetch(`/api/events/${event.id}/schedule`, {
      token,
      method: "PUT",
      body: JSON.stringify(buildSchedulePayload()),
    });
    return { token, event };
  }

  async function handleSaveDraft() {
    setSubmitError("");
    if (!validateTicketsScreen() || !validateQuickPass()) return;
    setSaving(true);
    try {
      await persistEvent();
      toast.success("Evento guardado como borrador.");
      navigate("/organizador/eventos");
    } catch (err) {
      setSubmitError(err.message || "No pudimos guardar el evento. Probá de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish() {
    setSubmitError("");
    if (!validateTicketsScreen() || !validateQuickPass()) return;
    setSaving(true);
    try {
      const publishedEvent = await run(
        async () => {
          const { token, event } = await persistEvent();
          const { event: updated } = await apiFetch(`/api/events/${event.id}`, {
            token,
            method: "PATCH",
            body: JSON.stringify({ status: "PUBLISHED" }),
          });
          return updated;
        },
        {
          // Mismo mecanismo exacto que OrganizerEventWizard#handlePublish:
          // si `run()` corta por timeout, confirma el estado REAL antes de
          // avisar que falló — nunca inventa un slug, siempre confirma
          // contra el evento persistido.
          checkOutcome: async () => {
            if (!eventIdRef.current) return null;
            const checkToken = await getToken();
            const { event } = await apiFetch(`/api/events/${eventIdRef.current}`, { token: checkToken });
            return event.status === "PUBLISHED" ? event : null;
          },
        }
      );
      setPublished({ slug: publishedEvent.slug, quickPassEnabled: general.quickPassEnabled });
      setScreen("success");
    } catch (err) {
      setSubmitError(err.message || "No pudimos publicar el evento. Probá de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  const totalCapacity = isFreeEntry ? null : validTicketTypes().reduce((sum, tt) => sum + (Number(tt.quantity) || 0), 0);

  if (screen === "success" && published) {
    const eventUrl = `${window.location.origin}/evento/${published.slug}`;
    const quickPassUrl = `${window.location.origin}/quick-pass/${published.slug}`;

    return (
      <ScreenShell>
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <PartyPopper className="h-10 w-10 text-violet-400" />
          <h1 className="text-2xl font-bold text-white">Tu evento está publicado</h1>
          <p className="text-sm text-slate-400">Ya está visible en el marketplace de Smarticket.</p>
        </div>

        <Card className="flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">URL evento</p>
          <p className="truncate text-sm text-violet-300">{window.location.host}/evento/{published.slug}</p>
          <div className="flex flex-wrap gap-2">
            <LinkButton to={`/evento/${published.slug}`} target="_blank" rel="noreferrer" variant="secondary" size="sm" className="gap-1.5">
              <ExternalLink className="h-3.5 w-3.5" />
              Abrir
            </LinkButton>
          </div>
          <ShareLinkPanel url={eventUrl} title={general.title} shareText={`Mirá mi evento: ${eventUrl}`} />
        </Card>

        {published.quickPassEnabled && (
          <Card className="flex flex-col gap-3 border-violet-500/20">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-violet-300">
              <Zap className="h-3.5 w-3.5" />
              Quick Pass
            </p>
            <p className="truncate text-sm text-violet-300">{window.location.host}/quick-pass/{published.slug}</p>
            <div className="flex flex-wrap gap-2">
              <LinkButton to={`/quick-pass/${published.slug}`} target="_blank" rel="noreferrer" variant="secondary" size="sm" className="gap-1.5">
                <ExternalLink className="h-3.5 w-3.5" />
                Abrir
              </LinkButton>
            </div>
            <ShareLinkPanel
              url={quickPassUrl}
              title={`Quick Pass — ${general.title}`}
              shareText={`Entrá a mi Quick Pass: ${quickPassUrl}`}
            />
          </Card>
        )}

        <Button onClick={() => navigate("/organizador/eventos")} className="w-full justify-center">
          Ver mis eventos
        </Button>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell>
      <div className="flex flex-col items-center gap-1 text-center">
        <span className="flex items-center gap-2 text-2xl font-extrabold text-white">
          <Zap className="h-6 w-6 text-violet-400" />
          Fest Pass
        </span>
        <p className="text-sm text-slate-400">Creá tu evento en minutos.</p>
      </div>

      {screen === "info" && (
        <Card className="flex flex-col gap-4">
          <Field label="Nombre del evento">
            <input
              className={inputClass}
              value={general.title}
              onChange={(e) => setGeneralField("title", e.target.value)}
              placeholder="Ej: Fiesta Neón"
            />
            <ErrorText message={errors.title} />
          </Field>

          <ImageUploader
            label="Foto del evento"
            value={general.coverImage}
            onChange={(url) => setGeneralField("coverImage", url || "")}
            previewHeightClass="h-56"
            aspectRatio={4 / 5}
          />

          <Field label="Categoría">
            <select
              className={inputClass}
              value={general.category}
              onChange={(e) => setGeneralField("category", e.target.value)}
            >
              {EVENT_CATEGORIES.map((cat) => (
                <option key={cat.id} value={cat.id} className="bg-[#0B1120]">
                  {cat.label}
                </option>
              ))}
            </select>
          </Field>

          {general.category === "OTRO" && (
            <Field label="Especificar categoría">
              <input
                className={inputClass}
                value={general.customCategory}
                onChange={(e) => setGeneralField("customCategory", e.target.value)}
                placeholder="Ej: Fiesta temática"
              />
              <ErrorText message={errors.customCategory} />
            </Field>
          )}

          <Field label="Descripción">
            <textarea
              className={textareaClass}
              value={general.description}
              onChange={(e) => setGeneralField("description", e.target.value)}
              placeholder="Contale a la gente de qué se trata"
            />
          </Field>

          <div className="flex flex-col gap-3 border-t border-white/10 pt-4">
            <p className="text-sm font-medium text-white">Lugar</p>
            <LocationPicker value={location} onChange={setLocation} required error={locationError} />
          </div>

          <div className="grid grid-cols-2 gap-3 border-t border-white/10 pt-4">
            <Field label="Fecha">
              <input
                type="date"
                className={inputClass}
                value={functionDate}
                onChange={(e) => {
                  setFunctionDate(e.target.value);
                  setErrors((prev) => ({ ...prev, functionDate: undefined }));
                }}
              />
              <ErrorText message={errors.functionDate} />
            </Field>
            <Field label="Hora">
              <TimePicker value={functionTime} onChange={setFunctionTime} />
            </Field>
          </div>

          {submitError && <p className="text-sm text-rose-400">{submitError}</p>}

          <Button onClick={handleContinue} className="w-full justify-center gap-2">
            Continuar
          </Button>
        </Card>
      )}

      {screen === "tickets" && (
        <>
          <Card className="flex flex-col gap-4">
            <button
              type="button"
              onClick={() => setScreen("info")}
              className="flex w-fit items-center gap-1.5 text-xs text-slate-400 hover:text-white"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Volver a tu evento
            </button>

            <p className="text-sm font-semibold text-white">Tipo de evento</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setAdmissionType("FREE_ENTRY")}
                className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                  isFreeEntry
                    ? "border-violet-500 bg-violet-500/10 text-violet-300"
                    : "border-white/10 bg-white/5 text-slate-400 hover:border-white/20"
                }`}
              >
                Entrada gratis
              </button>
              <button
                type="button"
                onClick={() => setAdmissionType("TICKETED")}
                className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                  !isFreeEntry
                    ? "border-violet-500 bg-violet-500/10 text-violet-300"
                    : "border-white/10 bg-white/5 text-slate-400 hover:border-white/20"
                }`}
              >
                Entrada paga
              </button>
            </div>

            {!isFreeEntry && (
              <div className="flex flex-col gap-3">
                {catalog.map((tt) => (
                  <div key={tt._key} className="flex flex-col gap-2 rounded-lg border border-white/10 bg-white/5 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <input
                        className={`${inputClass} flex-1`}
                        value={tt.name}
                        onChange={(e) => updateTicketType(tt._key, "name", e.target.value)}
                        placeholder="Ej: General"
                      />
                      {catalog.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeTicketType(tt._key)}
                          className="rounded-lg p-2 text-slate-500 hover:bg-white/10 hover:text-rose-400"
                          aria-label="Quitar tipo de entrada"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="number"
                        min={0}
                        className={inputClass}
                        value={tt.price}
                        onChange={(e) => updateTicketType(tt._key, "price", e.target.value)}
                        placeholder="Precio"
                      />
                      <input
                        type="number"
                        min={1}
                        className={inputClass}
                        value={tt.quantity}
                        onChange={(e) => updateTicketType(tt._key, "quantity", e.target.value)}
                        placeholder="Cantidad"
                      />
                    </div>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={addTicketType}
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/15 py-2.5 text-sm font-medium text-slate-400 hover:border-violet-500/60 hover:text-violet-300"
                >
                  <Plus className="h-4 w-4" />
                  Agregar entrada
                </button>
              </div>
            )}
          </Card>

          <Card className="flex flex-col gap-3 border-violet-500/20 bg-white/5">
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-sm font-semibold text-white">
                <Zap className="h-4 w-4 text-violet-400" />
                Quick Pass
              </span>
              <input
                type="checkbox"
                className="h-5 w-5 accent-violet-500"
                checked={general.quickPassEnabled}
                onChange={(e) => setGeneralField("quickPassEnabled", e.target.checked)}
              />
            </div>
            <HelpText>
              Creá también una experiencia de compra rápida para compartir en Instagram, WhatsApp y
              redes.
            </HelpText>

            {general.quickPassEnabled && (
              <>
                <ImageUploader
                  label="Imagen de Quick Pass"
                  value={general.quickPassImageUrl}
                  onChange={(url) => setGeneralField("quickPassImageUrl", url || "")}
                  previewHeightClass="h-64"
                  aspectRatio={9 / 16}
                  helperText="PNG, JPG, JPEG o WEBP. Máximo 5 MB."
                />
                <HelpText>Recomendado: imagen vertical 9:16 · 1080 × 1920 px</HelpText>
                {quickPassAspectWarning && (
                  <p className="text-xs text-amber-400">
                    Para que Quick Pass se vea mejor, recomendamos una imagen vertical 9:16.
                  </p>
                )}
                <ErrorText message={errors.quickPassImageUrl} />
              </>
            )}
          </Card>

          <Card className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Resumen</p>
            <div className="flex items-center gap-2 text-sm text-slate-300">
              <span className="font-medium text-white">{general.title || "Tu evento"}</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <CalendarDays className="h-4 w-4 text-slate-500" />
              {functionDate || "Fecha a confirmar"}
              {functionTime && ` · ${functionTime}hs`}
            </div>
            <p className="text-sm text-slate-400">{location.venueName || "Lugar a confirmar"}</p>
            <p className="text-sm text-slate-400">
              {isFreeEntry
                ? "Entrada gratuita"
                : `${validTicketTypes().length} tipo(s) de entrada · Capacidad total: ${totalCapacity ?? 0}`}
            </p>
            <p className="text-sm text-slate-400">
              Quick Pass: {general.quickPassEnabled ? "Activado" : "Desactivado"}
            </p>

            {!canPublish && (
              <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-amber-300">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <p className="text-xs opacity-90">
                  Tu organización todavía no fue aprobada. Podés guardar el evento como borrador.
                </p>
              </div>
            )}

            {submitError && <p className="text-sm text-rose-400">{submitError}</p>}

            <div className="mt-2 flex flex-col gap-2">
              <Button onClick={handlePublish} loading={saving} disabled={!canPublish} className="w-full justify-center gap-2">
                Publicar evento
              </Button>
              <Button onClick={handleSaveDraft} loading={saving} variant="secondary" className="w-full justify-center gap-2">
                Guardar borrador
              </Button>
            </div>
          </Card>
        </>
      )}
    </ScreenShell>
  );
}
