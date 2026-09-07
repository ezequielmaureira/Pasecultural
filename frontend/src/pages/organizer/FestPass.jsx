import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { Zap, Plus, Trash2, ExternalLink, ArrowLeft, PartyPopper, ShieldAlert, CalendarDays, Ticket as TicketIcon } from "lucide-react";
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
import { EVENT_CATEGORIES, getEventCategoryLabel } from "../../lib/eventCategories.js";
import { createEmptyTicketType, toDateTime, currency } from "./eventWizard/model.js";

// Fest Pass V2 — creador RÁPIDO de eventos (3 etapas: Tu evento / Entradas /
// Vista previa). Arma exactamente el mismo Event/EventFunction/TicketType
// que el resto de Smarticket, llamando a los MISMOS endpoints REST que ya
// usa OrganizerEventWizard.jsx (POST /api/events, PUT /schedule, PATCH
// status). Fest Pass ES la experiencia pública rápida — no pregunta si
// activarla: persiste quickPassEnabled=true internamente y reutiliza la
// ÚNICA foto cargada (general.coverImage) como quickPassImageUrl, sin pedir
// una segunda imagen. Esos nombres internos (quickPass*) son por
// compatibilidad con la infraestructura ya existente (assertQuickPassInvariant,
// getQuickPassBySlugService, ruta pública) — la UI nunca menciona "Quick
// Pass", sólo "Fest Pass". La URL pública que se comparte es /fest-pass/:slug,
// que en App.jsx monta el MISMO componente QuickPass.jsx ya existente (sin
// copiarlo) — /quick-pass/:slug sigue funcionando igual para compatibilidad.

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
  };
}

function ScreenShell({ children }) {
  return <div className="mx-auto flex w-full max-w-md flex-col gap-5 pb-10">{children}</div>;
}

const STAGE_LABEL = { info: "1. Tu evento", tickets: "2. Entradas", preview: "3. Vista previa" };

export default function FestPass() {
  const navigate = useNavigate();
  const { getToken } = useAuth();
  const toast = useToast();
  const { run } = usePublishFlow();
  const eventIdRef = useRef(null);

  const [screen, setScreen] = useState("info"); // info | tickets | preview | success
  const [general, setGeneral] = useState(createEmptyGeneral);
  const [location, setLocation] = useState(createEmptyLocation);
  const [locationError, setLocationError] = useState("");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("21:00");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("23:59");
  const [catalog, setCatalog] = useState(() => [createEmptyTicketType()]);
  const [organization, setOrganization] = useState(null);
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState("");
  const [saving, setSaving] = useState(false);
  const [published, setPublished] = useState(null); // { slug }

  // Fest Pass es EXCLUSIVAMENTE para eventos pagos — nunca FREE_ENTRY, nunca
  // un selector de tipo de evento. Un evento gratuito no necesita Fest Pass
  // (puede promocionarse por otros medios); si algún día se decide lo
  // contrario, es una decisión de producto/backend nueva, no un toggle acá.
  // Constante, no estado: nunca cambia dentro de este creador.
  const admissionType = "TICKETED";
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

  function setGeneralField(key, value) {
    setGeneral((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  function validateInfoScreen() {
    const nextErrors = {};
    if (!general.title.trim()) nextErrors.title = "El nombre del evento es obligatorio";
    if (!general.coverImage) nextErrors.coverImage = "Subí una foto para tu evento";
    if (general.category === "OTRO" && !general.customCategory.trim()) {
      nextErrors.customCategory = "Especificá el nombre de la categoría";
    }
    if (!startDate) nextErrors.startDate = "Elegí una fecha de inicio";
    if (!endDate) nextErrors.endDate = "Elegí una fecha de finalización";

    if (startDate && endDate) {
      const startIso = toDateTime(startDate, startTime);
      const endIso = toDateTime(endDate, endTime);
      if (startIso && endIso && new Date(endIso) <= new Date(startIso)) {
        nextErrors.endDate = "La finalización debe ser posterior al inicio";
      }
    }

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

  function handleContinueToTickets() {
    if (!validateInfoScreen()) return;
    setScreen("tickets");
  }

  function addTicketType() {
    setCatalog((prev) => [...prev, createEmptyTicketType()]);
  }

  // Nunca deja el catálogo en 0 filas — siempre queda al menos una fila
  // visible para completar, nunca una sección totalmente vacía.
  function removeTicketType(key) {
    setCatalog((prev) => (prev.length > 1 ? prev.filter((tt) => tt._key !== key) : prev));
  }

  function updateTicketType(key, field, value) {
    setCatalog((prev) => prev.map((tt) => (tt._key === key ? { ...tt, [field]: value } : tt)));
  }

  // Defensa adicional para el payload (backend sigue siendo la autoridad
  // real): sólo cuentan filas con nombre, precio > 0 y cantidad > 0 — un
  // precio o cantidad en 0 NUNCA se considera una entrada válida acá.
  function validTicketTypes() {
    return catalog.filter((tt) => tt.name.trim() && Number(tt.price) > 0 && Number(tt.quantity) > 0);
  }

  // Fest Pass es sólo pago: TODAS las filas del catálogo deben estar
  // completas (nombre, precio > 0, cantidad > 0) antes de avanzar — si el
  // Organizer no quiere una fila, debe quitarla con el ícono de basura, no
  // dejarla vacía. Validación de UX; el backend (assertQuickPassInvariant/
  // NO_TICKET_TYPES/TICKET_TYPE_MISSING_FIELDS) sigue siendo la autoridad.
  function validateTicketsScreen() {
    const hasInvalidRow = catalog.some(
      (tt) => !tt.name.trim() || tt.price === "" || Number(tt.price) <= 0 || tt.quantity === "" || Number(tt.quantity) <= 0
    );
    if (hasInvalidRow) {
      setSubmitError("Completá nombre, precio (mayor a $0) y cantidad (mayor a 0) en todas las entradas.");
      return false;
    }
    setSubmitError("");
    return true;
  }

  function handleContinueToPreview() {
    if (!validateTicketsScreen()) return;
    setScreen("preview");
  }

  // Mismo shape exacto que buildGeneralPayload de OrganizerEventWizard.jsx,
  // salvo que acá quickPassEnabled/quickPassImageUrl NUNCA los decide el
  // usuario: Fest Pass siempre activa la experiencia pública rápida, y
  // reutiliza la ÚNICA foto cargada (coverImage) como su imagen — nunca se
  // pide una segunda imagen. El creador clásico (OrganizerEventWizard.jsx)
  // no se toca: ahí coverImage y quickPassImageUrl siguen siendo
  // completamente independientes.
  function buildEventPayload() {
    return {
      title: general.title,
      coverImage: general.coverImage || null,
      category: general.category,
      customCategory: general.category === "OTRO" ? general.customCategory : null,
      description: general.description,
      admissionType,
      location,
      quickPassEnabled: true,
      quickPassImageUrl: general.coverImage || null,
    };
  }

  function buildSchedulePayload() {
    const types = validTicketTypes();
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
          // endAt es una columna DateTime independiente en EventFunction
          // (ver schema.prisma) — se construye acá con su propia fecha,
          // nunca forzada al mismo día que `date`, sin agregar ningún campo
          // nuevo ni cambiar el backend.
          date: toDateTime(startDate, startTime),
          doorsOpenAt: null,
          endAt: toDateTime(endDate, endTime),
          venue: location.venueName,
          address: location.addressLine || location.formattedAddress || null,
          capacity: null,
          status: "SCHEDULED",
          // IMPORTANTE (bug encontrado y corregido): se arma el shape EXACTO
          // que espera el backend (event.service.js#syncEventScheduleService,
          // ~línea 867) — null real, nunca "". Antes se reenviaba
          // createDefaultAssignment() tal cual (forma de UI interna del
          // wizard clásico, con priceOverride/quantityOverride en "" cuando
          // "usar catálogo" está activo); el backend hace `Number("")` = 0
          // sobre esa forma sin traducir, pisando silenciosamente el
          // precio/cantidad reales del TicketType a 0 (por eso una entrada
          // paga aparecía como "Gratis" y con disponibilidad 0 en
          // /fest-pass/:slug).
          ticketAssignments: types.map(() => ({
            enabled: true,
            priceOverride: null,
            quantityOverride: null,
            visibleOverride: null,
          })),
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
          checkOutcome: async () => {
            if (!eventIdRef.current) return null;
            const checkToken = await getToken();
            const { event } = await apiFetch(`/api/events/${eventIdRef.current}`, { token: checkToken });
            return event.status === "PUBLISHED" ? event : null;
          },
        }
      );
      setPublished({ slug: publishedEvent.slug });
      setScreen("success");
    } catch (err) {
      setSubmitError(err.message || "No pudimos publicar el evento. Probá de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  const totalCapacity = validTicketTypes().reduce((sum, tt) => sum + (Number(tt.quantity) || 0), 0);

  // ===================== ÉXITO =====================
  if (screen === "success" && published) {
    const festPassUrl = `${window.location.origin}/fest-pass/${published.slug}`;

    return (
      <ScreenShell>
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <PartyPopper className="h-10 w-10 text-violet-400" />
          <h1 className="text-2xl font-bold text-white">Tu Fest Pass está publicado</h1>
          <p className="text-sm text-slate-400">Ya está visible en el marketplace de Smarticket.</p>
        </div>

        <Card className="flex flex-col gap-3 border-violet-500/20">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-violet-300">
            <Zap className="h-3.5 w-3.5" />
            Tu enlace Fest Pass
          </p>
          <p className="truncate text-sm text-violet-300">{window.location.host}/fest-pass/{published.slug}</p>
          <div className="flex flex-wrap gap-2">
            <LinkButton to={`/fest-pass/${published.slug}`} target="_blank" rel="noreferrer" variant="secondary" size="sm" className="gap-1.5">
              <ExternalLink className="h-3.5 w-3.5" />
              Abrir
            </LinkButton>
          </div>
          <ShareLinkPanel url={festPassUrl} title={general.title} shareText={`Entrá a mi Fest Pass: ${festPassUrl}`} />
        </Card>

        <Button onClick={() => navigate("/organizador/eventos")} className="w-full justify-center">
          Ver mis eventos
        </Button>
      </ScreenShell>
    );
  }

  // ===================== VISTA PREVIA =====================
  if (screen === "preview") {
    const types = validTicketTypes();
    const locationLabel = [location.venueName, location.city].filter(Boolean).join(" · ");

    return (
      <ScreenShell>
        <div className="flex flex-col items-center gap-1 text-center">
          <span className="flex items-center gap-2 text-2xl font-extrabold text-white">
            <Zap className="h-6 w-6 text-violet-400" />
            Fest Pass
          </span>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{STAGE_LABEL.preview}</p>
        </div>

        {/* Simulación visual de la pantalla pública — mismo espíritu que
            /fest-pass/:slug (QuickPass.jsx), nunca un checkout real: el CTA
            de acá no navega ni compra nada. */}
        <div className="mx-auto w-full max-w-xs overflow-hidden rounded-2xl border border-white/10 bg-black">
          <div className="relative aspect-[9/16] w-full bg-black/40">
            {general.coverImage ? (
              <img src={general.coverImage} alt={general.title} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-slate-600">Sin foto</div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 p-4">
              <span className="w-fit rounded-full bg-violet-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-200">
                {getEventCategoryLabel(general)}
              </span>
              <h2 className="text-lg font-bold leading-tight text-white">{general.title || "Nombre del evento"}</h2>
              <div className="flex items-center gap-1.5 text-xs text-white/80">
                <CalendarDays className="h-3.5 w-3.5" />
                {startDate || "Fecha a confirmar"}
                {startTime && ` · ${startTime}hs`}
              </div>
              <p className="text-xs text-white/70">{locationLabel || "Lugar a confirmar"}</p>
              <button
                type="button"
                onClick={(e) => e.preventDefault()}
                className="mt-1 flex items-center justify-center gap-1.5 rounded-full bg-gradient-to-r from-fuchsia-500 via-violet-500 to-blue-500 py-2.5 text-sm font-bold text-white"
              >
                <TicketIcon className="h-4 w-4" />
                Comprar entradas
              </button>
            </div>
          </div>
        </div>

        <Card className="flex flex-col gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Inicio</p>
            <p className="text-sm text-slate-300">
              {startDate || "—"} {startTime && `· ${startTime}hs`}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Finalización</p>
            <p className="text-sm text-slate-300">
              {endDate || "—"} {endTime && `· ${endTime}hs`}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Lugar</p>
            <p className="text-sm text-slate-300">{locationLabel || "Lugar a confirmar"}</p>
          </div>
          {general.description && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Descripción</p>
              <p className="whitespace-pre-line text-sm text-slate-300">{general.description}</p>
            </div>
          )}
          <div className="flex flex-col gap-2 border-t border-white/10 pt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Entradas</p>
            {types.map((tt) => (
              <div key={tt._key} className="flex items-center justify-between text-sm">
                <span className="text-slate-300">{tt.name}</span>
                <span className="text-slate-400">
                  {currency(tt.price)} · {tt.quantity} disponibles
                </span>
              </div>
            ))}
          </div>
        </Card>

        {!canPublish && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-amber-300">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="text-xs opacity-90">
              Tu organización todavía no fue aprobada. Podés guardar el evento como borrador.
            </p>
          </div>
        )}

        {submitError && <p className="text-sm text-rose-400">{submitError}</p>}

        <div className="flex flex-col gap-2">
          <Button onClick={handlePublish} loading={saving} disabled={!canPublish} className="w-full justify-center gap-2">
            Publicar evento
          </Button>
          <Button onClick={handleSaveDraft} loading={saving} variant="secondary" className="w-full justify-center gap-2">
            Guardar borrador
          </Button>
          <button
            type="button"
            onClick={() => setScreen("tickets")}
            className="flex items-center justify-center gap-1.5 py-1 text-xs text-slate-400 hover:text-white"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Editar
          </button>
        </div>
      </ScreenShell>
    );
  }

  // ===================== TU EVENTO / ENTRADAS =====================
  return (
    <ScreenShell>
      <div className="flex flex-col items-center gap-1 text-center">
        <span className="flex items-center gap-2 text-2xl font-extrabold text-white">
          <Zap className="h-6 w-6 text-violet-400" />
          Fest Pass
        </span>
        <p className="text-sm text-slate-400">Creá tu evento en minutos.</p>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{STAGE_LABEL[screen]}</p>
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

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-400">Foto del evento</span>
            <ImageUploader
              value={general.coverImage}
              onChange={(url) => setGeneralField("coverImage", url || "")}
              previewHeightClass="h-40"
              label=""
              helperText="Se muestra completa, sin recortar. PNG, JPG, JPEG o WEBP. Máximo 5 MB."
            />
            {general.coverImage && (
              <p className="text-center text-xs font-medium text-violet-400">Tocá la imagen para cambiar la foto</p>
            )}
            <ErrorText message={errors.coverImage} />
          </div>

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

          <div className="flex flex-col gap-3 border-t border-white/10 pt-4">
            <p className="text-sm font-medium text-white">Inicio</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Fecha">
                <input
                  type="date"
                  className={inputClass}
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    setErrors((prev) => ({ ...prev, startDate: undefined }));
                  }}
                />
                <ErrorText message={errors.startDate} />
              </Field>
              <Field label="Hora">
                <TimePicker value={startTime} onChange={setStartTime} />
              </Field>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-white/10 pt-4">
            <p className="text-sm font-medium text-white">Finalización</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Fecha">
                <input
                  type="date"
                  className={inputClass}
                  value={endDate}
                  onChange={(e) => {
                    setEndDate(e.target.value);
                    setErrors((prev) => ({ ...prev, endDate: undefined }));
                  }}
                />
                <ErrorText message={errors.endDate} />
              </Field>
              <Field label="Hora">
                <TimePicker value={endTime} onChange={setEndTime} />
              </Field>
            </div>
          </div>

          <Button onClick={handleContinueToTickets} className="w-full justify-center gap-2">
            Continuar
          </Button>
        </Card>
      )}

      {screen === "tickets" && (
        <Card className="flex flex-col gap-4">
          <button
            type="button"
            onClick={() => setScreen("info")}
            className="flex w-fit items-center gap-1.5 text-xs text-slate-400 hover:text-white"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Volver a tu evento
          </button>

          <p className="text-sm font-semibold text-white">Entradas</p>

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
                    min={1}
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

          <div className="flex flex-col gap-1 border-t border-white/10 pt-3 text-sm text-slate-400">
            <p>{general.title || "Tu evento"}</p>
            <p>{validTicketTypes().length} tipo(s) · Capacidad total: {totalCapacity}</p>
          </div>

          {submitError && <p className="text-sm text-rose-400">{submitError}</p>}

          <Button onClick={handleContinueToPreview} className="w-full justify-center gap-2">
            Ver vista previa
          </Button>
        </Card>
      )}
    </ScreenShell>
  );
}
