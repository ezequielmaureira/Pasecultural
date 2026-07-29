import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import {
  ChevronRight,
  ChevronLeft,
  CalendarDays,
  MapPin,
  Ticket as TicketIcon,
  Plus,
  ShieldAlert,
} from "lucide-react";
import Card from "../../components/ui/Card.jsx";
import Button from "../../components/ui/Button.jsx";
import { Field, inputClass, textareaClass } from "../../components/ui/FormField.jsx";
import ImageUploader from "../../components/ui/ImageUploader.jsx";
import { apiFetch } from "../../lib/api.js";
import { EVENT_CATEGORIES, getEventCategoryLabel } from "../../lib/eventCategories.js";
import { canPublishEvents } from "../../lib/organizationTrust.js";
import FunctionCard from "./eventWizard/FunctionCard.jsx";
import TicketCatalogEditor from "./eventWizard/TicketCatalogEditor.jsx";
import EventLinksEditor from "./eventWizard/EventLinksEditor.jsx";
import SocialLinks from "../../components/events/SocialLinks.jsx";
import MediaEmbed from "../../components/events/MediaEmbed.jsx";
import LocationPicker from "../../components/location/LocationPicker.jsx";
import LocationMap from "../../components/location/LocationMap.jsx";
import { createEmptyLocation, hasCoordinates } from "../../lib/locationUtils.js";
import { parseMediaUrl } from "../../utils/mediaParser.js";
import {
  tempId,
  createEmptyTicketType,
  createDefaultAssignment,
  createEmptyFunction,
  createEmptyLink,
  fromDateTime,
  toDateTime,
  currency,
  reconcileAssignments,
  effectivePrice,
  effectiveQuantity,
  effectiveVisible,
} from "./eventWizard/model.js";

const STEPS = [
  { id: 1, label: "Evento" },
  { id: 2, label: "Enlaces del Evento" },
  { id: 3, label: "Catálogo de entradas" },
  { id: 4, label: "Programación" },
  { id: 5, label: "Vista previa" },
];

function createEmptyGeneralForm() {
  return {
    title: "",
    coverImage: "",
    category: EVENT_CATEGORIES[0].id,
    customCategory: "",
    shortDescription: "",
    description: "",
  };
}

// `clickable` habilita saltar directo a cualquier sección tocando su círculo
// (solo tiene sentido al reeditar un evento existente: en la creación desde
// cero el orden de los pasos todavía importa para no pedir datos fuera de
// contexto).
function StepIndicator({ step, onStepClick, clickable }) {
  return (
    <div className="mb-8 flex items-center justify-center gap-2 overflow-x-auto pb-1">
      {STEPS.map((s, index) => (
        <div key={s.id} className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            disabled={!clickable}
            onClick={() => onStepClick(s.id)}
            className={`flex flex-col items-center gap-1.5 rounded-lg ${
              clickable ? "cursor-pointer hover:opacity-80" : "cursor-default"
            }`}
          >
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-colors duration-150 ${
                s.id === step
                  ? "bg-violet-600 text-white"
                  : s.id < step
                  ? "bg-violet-500/20 text-violet-300"
                  : "bg-white/5 text-slate-500"
              }`}
            >
              {s.id}
            </div>
            <span
              className={`hidden text-[11px] sm:block ${
                s.id === step ? "text-violet-300" : "text-slate-500"
              }`}
            >
              {s.label}
            </span>
          </button>
          {index < STEPS.length - 1 && (
            <div className="h-px w-8 shrink-0 bg-white/10 sm:w-12" />
          )}
        </div>
      ))}
    </div>
  );
}

function ErrorText({ message }) {
  if (!message) return null;
  return <p className="mt-1 text-xs text-rose-400">{message}</p>;
}

function HelpText({ children }) {
  return <p className="text-xs leading-relaxed text-slate-500">{children}</p>;
}

function initialFunctions() {
  return [{ ...createEmptyFunction(), ticketAssignments: [createDefaultAssignment()] }];
}

export default function OrganizerEventWizard() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { getToken } = useAuth();
  const isEditing = Boolean(id);

  const [step, setStep] = useState(1);
  const [general, setGeneral] = useState(createEmptyGeneralForm);
  const [location, setLocation] = useState(createEmptyLocation);
  const [locationError, setLocationError] = useState("");
  const [links, setLinks] = useState([]);
  const [catalog, setCatalog] = useState([createEmptyTicketType()]);
  const [functions, setFunctions] = useState(initialFunctions);
  const [expandedFunctionKey, setExpandedFunctionKey] = useState(() => functions[0]._key);

  const [organization, setOrganization] = useState(null);
  const [loading, setLoading] = useState(isEditing);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const token = await getToken();
        const { organization: org } = await apiFetch("/api/organizations/me", { token });
        if (!cancelled) setOrganization(org);
      } catch (err) {
        console.error("No se pudo obtener la organización", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [getToken]);

  // Al entrar a Programación, las funciones que todavía no tienen lugar/dirección
  // propios heredan el "lugar base" seleccionado en el paso 1 (evita cargarlo dos veces).
  // Si la función ya tiene su propio valor, no se pisa.
  useEffect(() => {
    if (step !== 4) return;
    const venueName = location.venueName;
    const addressLine = location.addressLine || location.formattedAddress;
    if (!venueName && !addressLine) return;

    setFunctions((prev) =>
      prev.map((fn) => ({
        ...fn,
        venue: fn.venue || venueName,
        address: fn.address || addressLine,
      }))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  useEffect(() => {
    if (!isEditing) return;
    let cancelled = false;

    (async () => {
      try {
        const token = await getToken();
        const { event } = await apiFetch(`/api/events/${id}`, { token });
        if (cancelled || !event) return;

        setGeneral({
          title: event.title || "",
          coverImage: event.coverImage || "",
          category: event.category || EVENT_CATEGORIES[0].id,
          customCategory: event.customCategory || "",
          shortDescription: event.shortDescription || "",
          description: event.description || "",
        });

        setLocation({
          venueName: event.venueName || event.venue || "",
          formattedAddress: event.formattedAddress || "",
          addressLine: event.addressLine || event.address || "",
          city: event.city || "",
          province: event.province || "",
          country: event.country || "",
          postalCode: event.postalCode || "",
          latitude: event.latitude ?? null,
          longitude: event.longitude ?? null,
          googlePlaceId: event.googlePlaceId || "",
        });

        setLinks(
          event.links?.length
            ? event.links.map((link) => ({
                _key: link.id,
                url: link.url || "",
                title: link.title || "",
                type: link.type || null,
                embedUrl: link.embedUrl || null,
                thumbnail: link.thumbnail || null,
                isEmbeddable: link.isEmbeddable ?? false,
                error: undefined,
              }))
            : []
        );

        const loadedCatalog = event.ticketTypes?.length
          ? event.ticketTypes.map((tt) => ({
              _key: tt.id,
              name: tt.name || "",
              price: tt.price ?? "",
              quantity: tt.quantity ?? "",
              maxPerPurchase: tt.maxPerPurchase ?? 10,
              description: tt.description || "",
              visible: tt.visible ?? true,
            }))
          : [createEmptyTicketType()];

        const loadedFunctions = event.functions?.length
          ? event.functions.map((fn) => {
              const { date, time: startTime } = fromDateTime(fn.date);
              const { time: doorsOpenTime } = fromDateTime(fn.doorsOpenAt);
              const { time: endTime } = fromDateTime(fn.endAt);
              const ticketAssignments = loadedCatalog.map((_, index) => {
                const sourceTicketTypeId = event.ticketTypes?.[index]?.id;
                const assignment = fn.ticketAssignments?.find(
                  (a) => a.ticketTypeId === sourceTicketTypeId
                );
                if (!assignment) return createDefaultAssignment();
                return {
                  enabled: assignment.enabled ?? true,
                  useCatalogPrice:
                    assignment.priceOverride === null || assignment.priceOverride === undefined,
                  priceOverride: assignment.priceOverride ?? "",
                  useCatalogQuantity:
                    assignment.quantityOverride === null ||
                    assignment.quantityOverride === undefined,
                  quantityOverride: assignment.quantityOverride ?? "",
                  useCatalogVisible:
                    assignment.visibleOverride === null ||
                    assignment.visibleOverride === undefined,
                  visibleOverride: assignment.visibleOverride ?? true,
                };
              });

              return {
                _key: fn.id,
                date,
                doorsOpenTime,
                startTime,
                endTime,
                venue: fn.venue || "",
                address: fn.address || "",
                capacity: fn.capacity ?? "",
                status: fn.status || "SCHEDULED",
                copiedFromPrevious: false,
                ticketAssignments,
              };
            })
          : [
              {
                ...createEmptyFunction(),
                ticketAssignments: loadedCatalog.map(() => createDefaultAssignment()),
              },
            ];

        setCatalog(loadedCatalog);
        setFunctions(loadedFunctions);
        setExpandedFunctionKey(loadedFunctions[0]._key);
      } catch (err) {
        console.error("No se pudo cargar el evento", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, isEditing, getToken]);

  const canPublish = canPublishEvents(organization);

  function setGeneralField(key, value) {
    setGeneral((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  function addLink() {
    setLinks((prev) => [...prev, createEmptyLink()]);
  }

  function removeLink(index) {
    setLinks((prev) => prev.filter((_, i) => i !== index));
  }

  // MediaParser detecta la plataforma en cuanto el organizador pega la URL:
  // no hay selector manual de tipo. Si es un link de YouTube sin video
  // puntual (canal, playlist), se marca como inválido en el momento.
  function updateLink(index, key, value) {
    setLinks((prev) =>
      prev.map((link, i) => {
        if (i !== index) return link;

        if (key !== "url") {
          return { ...link, [key]: value };
        }

        try {
          const parsed = parseMediaUrl(value);
          return {
            ...link,
            url: value,
            error: undefined,
            type: parsed?.platform ?? null,
            embedUrl: parsed?.embedUrl ?? null,
            thumbnail: parsed?.thumbnail ?? null,
            isEmbeddable: parsed?.isEmbeddable ?? false,
          };
        } catch (err) {
          return {
            ...link,
            url: value,
            type: null,
            embedUrl: null,
            thumbnail: null,
            isEmbeddable: false,
            error:
              err.message === "LINK_INVALID_VIDEO"
                ? "Ese enlace de YouTube no tiene un video válido."
                : "La URL no es válida.",
          };
        }
      })
    );
  }

  function addCatalogItem() {
    setCatalog((prev) => {
      const next = [...prev, createEmptyTicketType()];
      setFunctions((prevFns) =>
        prevFns.map((fn) => ({
          ...fn,
          ticketAssignments: reconcileAssignments(fn.ticketAssignments, next),
        }))
      );
      return next;
    });
  }

  function removeCatalogItem(index) {
    setCatalog((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((_, i) => i !== index);
      setFunctions((prevFns) =>
        prevFns.map((fn) => ({
          ...fn,
          ticketAssignments: fn.ticketAssignments.filter((_, i) => i !== index),
        }))
      );
      return next;
    });
  }

  function updateCatalogItem(index, key, value) {
    setCatalog((prev) => prev.map((tt, i) => (i === index ? { ...tt, [key]: value } : tt)));
  }

  function cloneFunction(source) {
    return {
      _key: tempId(),
      date: "",
      doorsOpenTime: "",
      startTime: "",
      endTime: "",
      venue: source.venue,
      address: source.address,
      capacity: source.capacity,
      status: "SCHEDULED",
      copiedFromPrevious: true,
      ticketAssignments: source.ticketAssignments.map((a) => ({ ...a })),
    };
  }

  function addFunction() {
    setFunctions((prev) => {
      const clone = cloneFunction(prev[prev.length - 1]);
      setExpandedFunctionKey(clone._key);
      return [...prev, clone];
    });
  }

  function removeFunction(index) {
    setFunctions((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  function updateFunctionField(index, key, value) {
    setFunctions((prev) =>
      prev.map((fn, i) => {
        if (i !== index) return fn;
        return { ...fn, [key]: value, copiedFromPrevious: false };
      })
    );
  }

  function updateAssignment(functionIndex, ticketIndex, patch) {
    setFunctions((prev) =>
      prev.map((fn, i) => {
        if (i !== functionIndex) return fn;
        return {
          ...fn,
          copiedFromPrevious: false,
          ticketAssignments: fn.ticketAssignments.map((a, j) =>
            j === ticketIndex ? { ...a, ...patch } : a
          ),
        };
      })
    );
  }

  function validateStep1() {
    const stepErrors = {};
    if (!general.title.trim()) stepErrors.title = "El nombre del evento es obligatorio";
    if (general.category === "OTRO" && !general.customCategory.trim()) {
      stepErrors.customCategory = "Especificá el nombre de la categoría";
    }
    setErrors(stepErrors);
    return Object.keys(stepErrors).length === 0;
  }

  // Se exige recién al publicar: un borrador puede guardarse con la ubicación
  // incompleta (spec), pero no se puede publicar sin lugar, dirección y coordenadas.
  function validateLocationForPublish() {
    const hasVenueName = Boolean(location.venueName.trim());
    const hasAddress = Boolean(location.formattedAddress.trim() || location.addressLine.trim());

    if (!hasVenueName || !hasAddress || !hasCoordinates(location)) {
      setLocationError(
        "Para publicar necesitás un lugar con nombre, dirección y una ubicación seleccionada en el mapa (buscá la dirección y elegí una sugerencia de la lista)."
      );
      return false;
    }

    setLocationError("");
    return true;
  }

  function validateStepLinks() {
    const seenUrls = new Set();
    let hasError = false;

    const nextLinks = links.map((link) => {
      const url = link.url.trim();
      let error;
      let parsed = null;

      if (!url) {
        error = "La URL es obligatoria";
      } else {
        try {
          parsed = parseMediaUrl(url);
          if (!parsed) {
            error = "La URL no es válida";
          } else if (seenUrls.has(url.toLowerCase())) {
            error = "Ya cargaste esta URL en otro enlace";
          } else {
            seenUrls.add(url.toLowerCase());
          }
        } catch (err) {
          error =
            err.message === "LINK_INVALID_VIDEO"
              ? "Ese enlace de YouTube no tiene un video válido."
              : "La URL no es válida";
        }
      }

      if (error) hasError = true;
      return {
        ...link,
        error,
        type: parsed?.platform ?? link.type,
        embedUrl: parsed?.embedUrl ?? link.embedUrl,
        thumbnail: parsed?.thumbnail ?? link.thumbnail,
        isEmbeddable: parsed?.isEmbeddable ?? link.isEmbeddable,
      };
    });

    setLinks(nextLinks);
    return !hasError;
  }

  function validateStep3() {
    return (
      catalog.length > 0 &&
      catalog.every((tt) => tt.name.trim() && tt.price !== "" && tt.quantity !== "")
    );
  }

  function validateStep4() {
    return (
      functions.length > 0 &&
      functions.every(
        (fn) =>
          fn.date &&
          fn.startTime &&
          fn.venue.trim() &&
          fn.ticketAssignments.some((a) => a.enabled)
      )
    );
  }

  function goNext() {
    if (step === 1 && !validateStep1()) return;
    if (step === 2 && !validateStepLinks()) {
      setSubmitError("Revisá las URLs de los enlaces cargados.");
      return;
    }
    if (step === 3 && !validateStep3()) {
      setSubmitError("Completá nombre, precio y cantidad de todas las entradas del catálogo.");
      return;
    }
    if (step === 4 && !validateStep4()) {
      setSubmitError(
        "Completá fecha, hora de inicio y lugar, y asigná al menos una entrada a cada función."
      );
      return;
    }
    setSubmitError("");
    setStep((s) => Math.min(s + 1, STEPS.length));
  }

  function goBack() {
    setStep((s) => Math.max(s - 1, 1));
  }

  function buildGeneralPayload() {
    return {
      title: general.title,
      coverImage: general.coverImage || null,
      category: general.category,
      customCategory: general.category === "OTRO" ? general.customCategory : null,
      shortDescription: general.shortDescription,
      description: general.description,
      location,
    };
  }

  // La plataforma (type/embedUrl/thumbnail/isEmbeddable) la vuelve a calcular
  // el backend con MediaParser al guardar; acá solo mandamos lo que el
  // organizador realmente cargó.
  function buildLinksPayload() {
    return links.map((link) => ({
      title: link.title.trim() || null,
      url: link.url.trim(),
    }));
  }

  function buildSchedulePayload() {
    return {
      ticketTypes: catalog.map((tt) => ({
        name: tt.name,
        price: Number(tt.price),
        quantity: Number(tt.quantity),
        maxPerPurchase: Number(tt.maxPerPurchase) || 10,
        description: tt.description || null,
        visible: Boolean(tt.visible),
      })),
      functions: functions.map((fn) => ({
        date: toDateTime(fn.date, fn.startTime),
        doorsOpenAt: fn.doorsOpenTime ? toDateTime(fn.date, fn.doorsOpenTime) : null,
        endAt: fn.endTime ? toDateTime(fn.date, fn.endTime) : null,
        venue: fn.venue,
        address: fn.address || null,
        capacity: fn.capacity ? Number(fn.capacity) : null,
        status: fn.status,
        ticketAssignments: fn.ticketAssignments.map((a) => ({
          enabled: Boolean(a.enabled),
          priceOverride: a.useCatalogPrice ? null : Number(a.priceOverride),
          quantityOverride: a.useCatalogQuantity ? null : Number(a.quantityOverride),
          visibleOverride: a.useCatalogVisible ? null : Boolean(a.visibleOverride),
        })),
      })),
    };
  }

  async function persist() {
    const token = await getToken();
    const generalPayload = buildGeneralPayload();

    let eventId = id;
    if (isEditing) {
      await apiFetch(`/api/events/${eventId}`, {
        token,
        method: "PATCH",
        body: JSON.stringify(generalPayload),
      });
    } else {
      const { event } = await apiFetch("/api/events", {
        token,
        method: "POST",
        body: JSON.stringify(generalPayload),
      });
      eventId = event.id;
    }

    await apiFetch(`/api/events/${eventId}/links`, {
      token,
      method: "PUT",
      body: JSON.stringify({ links: buildLinksPayload() }),
    });

    await apiFetch(`/api/events/${eventId}/schedule`, {
      token,
      method: "PUT",
      body: JSON.stringify(buildSchedulePayload()),
    });

    return { token, eventId };
  }

  async function handleSaveDraft() {
    if (!validateStep1() || !validateStepLinks() || !validateStep3() || !validateStep4()) {
      setSubmitError("Revisá los datos del evento antes de guardar.");
      return;
    }

    setSubmitting(true);
    setSubmitError("");

    try {
      await persist();
      navigate("/organizador/eventos");
    } catch (err) {
      setSubmitError(err.message || "No pudimos guardar el evento. Probá de nuevo.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePublish() {
    const locationValid = validateLocationForPublish();
    if (!validateStep1() || !locationValid || !validateStepLinks() || !validateStep3() || !validateStep4()) {
      setSubmitError("Revisá los datos del evento antes de publicar.");
      if (!locationValid) setStep(1);
      return;
    }

    setSubmitting(true);
    setSubmitError("");

    try {
      const { token, eventId } = await persist();
      await apiFetch(`/api/events/${eventId}`, {
        token,
        method: "PATCH",
        body: JSON.stringify({ status: "PUBLISHED" }),
      });
      navigate("/organizador/eventos");
    } catch (err) {
      setSubmitError(err.message || "No pudimos publicar el evento. Probá de nuevo.");
    } finally {
      setSubmitting(false);
    }
  }

  let publishButtonLabel = isEditing ? "Guardar y publicar" : "Publicar";
  if (submitting) publishButtonLabel = "Publicando...";

  if (loading) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-slate-400">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/10 border-t-violet-500" />
        <p className="text-sm">Cargando evento...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">
            {isEditing ? "Editar evento" : "Crear evento"}
          </h1>
          <p className="text-sm text-slate-400">
            Completá los datos de tu evento en {STEPS.length} pasos
          </p>
        </div>
        <Link to="/organizador/eventos">
          <Button type="button" variant="ghost">
            Cancelar
          </Button>
        </Link>
      </div>

      <StepIndicator step={step} onStepClick={setStep} clickable={isEditing} />

      <Card>
        {step === 1 && (
          <div className="flex flex-col gap-4">
            <p className="text-sm font-semibold text-white">Paso 1 · Evento</p>

            <Field label="Nombre">
              <input
                className={inputClass}
                value={general.title}
                onChange={(e) => setGeneralField("title", e.target.value)}
                placeholder="Ej: Rock Nacional"
              />
              <ErrorText message={errors.title} />
            </Field>

            <ImageUploader
              label="Flyer"
              value={general.coverImage}
              onChange={(url) => setGeneralField("coverImage", url || "")}
              previewHeightClass="h-72"
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
                  placeholder="Ej: Conferencia, Exposición, Congreso, Feria..."
                />
                <ErrorText message={errors.customCategory} />
              </Field>
            )}

            <Field label="Descripción corta">
              <input
                className={inputClass}
                value={general.shortDescription}
                onChange={(e) => setGeneralField("shortDescription", e.target.value)}
                placeholder="Una frase que resuma tu evento"
                maxLength={140}
              />
            </Field>

            <Field label="Descripción completa">
              <textarea
                className={textareaClass}
                value={general.description}
                onChange={(e) => setGeneralField("description", e.target.value)}
                placeholder="Contale al público de qué se trata el evento"
              />
            </Field>

            <div className="flex flex-col gap-4 border-t border-white/10 pt-4">
              <div>
                <p className="text-sm font-medium text-white">Lugar base</p>
                <p className="text-xs text-slate-500">
                  Se usa como referencia general del evento. Cada función puede tener su propio
                  lugar si hace falta.
                </p>
              </div>

              <LocationPicker
                value={location}
                onChange={(nextLocation) => {
                  setLocation(nextLocation);
                  setLocationError("");
                }}
                required
                error={locationError}
              />
            </div>
          </div>
        )}

        {step === 2 && (
          <EventLinksEditor
            links={links}
            onAdd={addLink}
            onRemove={removeLink}
            onChange={updateLink}
          />
        )}

        {step === 3 && (
          <TicketCatalogEditor
            catalog={catalog}
            onAdd={addCatalogItem}
            onRemove={removeCatalogItem}
            onChange={updateCatalogItem}
          />
        )}

        {step === 4 && (
          <div className="flex flex-col gap-5">
            <p className="text-sm font-semibold text-white">Paso 4 · Programación</p>

            <HelpText>
              Una función representa una fecha y horario específico del evento. Por ejemplo:
              Viernes 20:30, Sábado 20:30, Domingo 19:00.
            </HelpText>

            <div className="flex flex-col gap-3">
              {functions.map((fn, index) => (
                <FunctionCard
                  key={fn._key}
                  fn={fn}
                  index={index}
                  catalog={catalog}
                  expanded={expandedFunctionKey === fn._key}
                  onToggle={() =>
                    setExpandedFunctionKey(expandedFunctionKey === fn._key ? null : fn._key)
                  }
                  onChange={(key, value) => updateFunctionField(index, key, value)}
                  onAssignmentChange={(ticketIndex, patch) =>
                    updateAssignment(index, ticketIndex, patch)
                  }
                  onRemove={() => removeFunction(index)}
                  canRemove={functions.length > 1}
                />
              ))}
            </div>

            <button
              type="button"
              onClick={addFunction}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/15 py-2.5 text-sm font-medium text-slate-400 hover:border-violet-500/60 hover:text-violet-300"
            >
              <Plus className="h-4 w-4" />
              Agregar otra función
            </button>
          </div>
        )}

        {step === 5 && (
          <div className="flex flex-col gap-4">
            <p className="text-sm font-semibold text-white">Paso 5 · Vista previa</p>
            <p className="text-xs text-slate-500">
              Así es como va a ver el evento el público una vez publicado.
            </p>

            <div className="overflow-hidden rounded-xl border border-white/10 bg-[#05070B]">
              <div className="mx-auto w-full max-w-xs sm:max-w-sm">
                <div className="aspect-[4/5] w-full bg-black/30">
                  {general.coverImage ? (
                    <img
                      src={general.coverImage}
                      alt={general.title}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-slate-600">
                      Sin flyer
                    </div>
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-3 p-5">
                <span className="w-fit rounded-full bg-violet-500/10 px-2.5 py-1 text-xs font-medium text-violet-300">
                  {getEventCategoryLabel(general)}
                </span>

                <h2 className="text-lg font-bold text-white">
                  {general.title || "Nombre del evento"}
                </h2>

                {general.shortDescription && (
                  <p className="text-sm text-slate-300">{general.shortDescription}</p>
                )}

                {general.description && (
                  <p className="whitespace-pre-line text-sm text-slate-400">
                    {general.description}
                  </p>
                )}
              </div>
            </div>

            {links.some((link) => link.isEmbeddable) && (
              <div className="flex flex-col gap-4">
                <p className="text-sm font-semibold text-white">Video promocional</p>
                {links
                  .filter((link) => link.isEmbeddable)
                  .map((link) => (
                    <MediaEmbed key={link._key} embedUrl={link.embedUrl} title={link.title} />
                  ))}
              </div>
            )}

            <SocialLinks links={links} />

            <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/5 p-4">
              <LocationMap
                latitude={location.latitude}
                longitude={location.longitude}
                venueName={location.venueName}
                formattedAddress={location.formattedAddress || location.addressLine}
              />
              {(location.city || location.province) && (
                <p className="text-xs text-slate-500">
                  {[location.city, location.province].filter(Boolean).join(", ")}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-3">
              {functions.map((fn, index) => (
                <div
                  key={fn._key}
                  className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 p-4"
                >
                  <p className="text-sm font-semibold text-white">Función {index + 1}</p>
                  <div className="flex items-center gap-2 text-sm text-slate-400">
                    <CalendarDays className="h-4 w-4 text-slate-500" />
                    {fn.date || "Fecha a confirmar"}
                    {fn.startTime && ` · ${fn.startTime}hs`}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-slate-400">
                    <MapPin className="h-4 w-4 text-slate-500" />
                    {fn.venue || "Lugar a confirmar"}
                  </div>

                  <div className="mt-2 flex flex-col gap-1.5">
                    {catalog.map((tt, ticketIndex) => {
                      const assignment = fn.ticketAssignments[ticketIndex];
                      if (!assignment?.enabled) return null;
                      const price = effectivePrice(tt, assignment);
                      const quantity = effectiveQuantity(tt, assignment);
                      const visible = effectiveVisible(tt, assignment);

                      return (
                        <div
                          key={tt._key}
                          className="flex items-center justify-between gap-2 rounded-lg bg-[#0B1120] px-3 py-2 text-sm"
                        >
                          <span className="flex items-center gap-2 text-slate-300">
                            <TicketIcon className="h-3.5 w-3.5 text-slate-500" />
                            {tt.name || "Entrada"}
                            <span className="text-xs text-slate-500">
                              ({quantity} disponibles{!visible ? " · oculta" : ""})
                            </span>
                          </span>
                          <span className="font-semibold text-violet-400">
                            {price === 0 ? "Gratis" : currency(price)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {!canPublish && (
              <div className="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-amber-300">
                <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
                <p className="text-xs opacity-90">
                  Tu organización todavía no fue aprobada. Podés guardar el evento como
                  borrador; vas a poder publicarlo apenas un Developer la apruebe.
                </p>
              </div>
            )}

            {submitError && <p className="text-sm text-rose-400">{submitError}</p>}
          </div>
        )}

        {step !== 5 && submitError && (
          <p className="mt-4 text-sm text-rose-400">{submitError}</p>
        )}

        <div className="mt-6 flex items-center justify-between border-t border-white/10 pt-4">
          <div>
            {step > 1 && (
              <Button type="button" variant="ghost" onClick={goBack} disabled={submitting}>
                <ChevronLeft className="h-4 w-4" />
                Atrás
              </Button>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            {step < STEPS.length && (
              <Button type="button" variant={isEditing ? "secondary" : "primary"} onClick={goNext}>
                Continuar
                <ChevronRight className="h-4 w-4" />
              </Button>
            )}

            {/* Al reeditar, cada sección puede guardarse sola: no hace falta
                recorrer los 5 pasos si sólo se cambió una cosa puntual. */}
            {(isEditing || step === STEPS.length) && (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleSaveDraft}
                  disabled={submitting}
                >
                  {submitting ? "Guardando..." : "Guardar borrador"}
                </Button>
                <Button
                  type="button"
                  onClick={handlePublish}
                  disabled={submitting || !canPublish}
                  title={!canPublish ? "Tu organización todavía no fue aprobada" : undefined}
                >
                  {publishButtonLabel}
                </Button>
              </>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
