import { Pencil, MapPin, CalendarDays, Ticket, Rocket, Save } from "lucide-react";
import Button from "../../../components/ui/Button.jsx";
import { parseMediaUrl } from "../../../utils/mediaParser.js";
import { getSocialNetworkIcon } from "../../../lib/socialNetworkIcons.js";

// stepId de entrada al que vuelve el motor cuando se pide editar cada
// sección desde el preview (backend/src/conversation/steps/definitions.js).
const EDIT_STEP_BY_SECTION = {
  info: "NAME",
  image: "COVER_IMAGE",
  location: "LOCATION",
  functions: "FUNCTIONS_MODE",
  tickets: "EVENT_PRICING_TYPE",
  video: "PROMO_VIDEO_ASK",
  social: "SOCIAL_LINKS_ASK",
};

function EditButton({ section, onEdit }) {
  return (
    <button
      type="button"
      onClick={() => onEdit(EDIT_STEP_BY_SECTION[section])}
      className="inline-flex min-h-[40px] items-center gap-1 rounded-lg px-3 py-2 text-xs font-medium text-violet-400 transition-colors duration-150 hover:bg-violet-500/10 hover:text-violet-300"
    >
      <Pencil className="h-3 w-3" />
      Editar
    </button>
  );
}

function SectionCard({ title, section, onEdit, children }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <EditButton section={section} onEdit={onEdit} />
      </div>
      {children}
    </div>
  );
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString("es-AR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export default function PreviewCard({
  draft,
  categoryLabel,
  onEdit,
  onSaveDraft,
  onPublish,
  submitting,
  publishing,
  error,
}) {
  return (
    <div className="flex w-full max-w-2xl flex-col gap-4">
      {draft.coverImage && (
        <div className="overflow-hidden rounded-xl border border-white/10">
          <img src={draft.coverImage} alt={draft.title} className="h-44 w-full object-cover sm:h-56" />
        </div>
      )}

      <SectionCard title="Información" section="info" onEdit={onEdit}>
        <h2 className="text-xl font-bold text-white">{draft.title}</h2>
        <span className="w-fit rounded-full bg-violet-500/15 px-2.5 py-1 text-xs font-medium text-violet-300">
          {categoryLabel}
        </span>
        <p className="text-sm text-slate-300">{draft.description}</p>
      </SectionCard>

      {!draft.coverImage && (
        <SectionCard title="Imagen" section="image" onEdit={onEdit}>
          <p className="text-sm text-slate-500">Sin imagen todavía.</p>
        </SectionCard>
      )}

      <SectionCard title="Ubicación" section="location" onEdit={onEdit}>
        <p className="flex items-center gap-2 text-sm text-slate-300">
          <MapPin className="h-4 w-4 shrink-0 text-violet-400" />
          {draft.location?.venueName ? `${draft.location.venueName} — ` : ""}
          {draft.location?.address}, {draft.location?.city}, {draft.location?.province}
        </p>
      </SectionCard>

      <SectionCard title="Funciones" section="functions" onEdit={onEdit}>
        <ul className="flex flex-col gap-1.5">
          {(draft.functions ?? []).map((fn, i) => (
            <li key={i} className="flex items-center gap-2 text-sm text-slate-300">
              <CalendarDays className="h-4 w-4 shrink-0 text-violet-400" />
              {formatDate(fn.date)} · {fn.startTime} a {fn.endTime}
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard title="Entradas" section="tickets" onEdit={onEdit}>
        {draft.hasTickets ? (
          <ul className="flex flex-col gap-1.5">
            {(draft.ticketTypes ?? []).map((tt, i) => (
              <li key={i} className="flex items-center gap-2 text-sm text-slate-300">
                <Ticket className="h-4 w-4 shrink-0 text-violet-400" />
                {tt.name} — ${tt.price} · {tt.quantity} disponibles
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-300">Evento gratuito</p>
        )}
      </SectionCard>

      {draft.promoVideoUrl && (
        <SectionCard title="Video promocional" section="video" onEdit={onEdit}>
          <div className="aspect-video w-full overflow-hidden rounded-xl border border-white/10">
            <iframe
              src={parseMediaUrl(draft.promoVideoUrl).embedUrl}
              title="Video promocional"
              className="h-full w-full"
              allowFullScreen
            />
          </div>
        </SectionCard>
      )}

      {draft.socialLinks?.length > 0 && (
        <SectionCard title="Redes" section="social" onEdit={onEdit}>
          <div className="flex flex-wrap gap-3">
            {draft.socialLinks.map((link, i) => {
              const Icon = getSocialNetworkIcon(link.network);
              return (
                <a
                  key={i}
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 hover:text-white"
                >
                  <Icon className="h-3.5 w-3.5 text-violet-400" />
                  {link.network}
                </a>
              );
            })}
          </div>
        </SectionCard>
      )}

      {error && <p className="text-sm text-rose-400">{error}</p>}

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button
          variant="secondary"
          loading={submitting && !publishing}
          loadingText="Guardando..."
          disabled={submitting}
          onClick={onSaveDraft}
          className="w-full sm:w-auto"
        >
          <Save className="h-4 w-4" />
          Guardar borrador
        </Button>
        <Button
          loading={publishing}
          loadingText="Publicando..."
          disabled={submitting}
          onClick={onPublish}
          className="w-full sm:w-auto"
        >
          <Rocket className="h-4 w-4" />
          Publicar
        </Button>
      </div>
    </div>
  );
}
