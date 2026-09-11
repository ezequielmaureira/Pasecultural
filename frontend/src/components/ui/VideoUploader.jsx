import { useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { FileVideo, X, Loader2, VideoOff } from "lucide-react";
import { apiUpload, apiFetch } from "../../lib/api.js";
import { useToast } from "../../context/ToastContext.jsx";

// Fest Pass — video de fondo OPCIONAL. Mismo patrón que ImageUploader.jsx
// (subida a /api/media/upload-video, mismo backend real que imágenes, sólo
// otro resource_type — ver media.service.js), sin editor de recorte: no
// tiene sentido recortar un video del lado del cliente para este alcance.
// La duración (<=30s) se valida SIEMPRE en el backend (después de subir,
// con la duración real que devuelve Cloudinary) — esta constante local es
// sólo para el mensaje de ayuda, nunca la fuente de verdad.
const ACCEPTED_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);
const MAX_FILE_SIZE = 100 * 1024 * 1024;

function validateFile(file) {
  if (!ACCEPTED_TYPES.has(file.type)) {
    return "Formato no soportado. Usá MP4, MOV o WEBM.";
  }
  if (file.size > MAX_FILE_SIZE) {
    return "El video no puede superar los 100 MB.";
  }
  return null;
}

export default function VideoUploader({
  value,
  // publicId YA PERSISTIDO en el Event (Event.quickPassVideoPublicId) —
  // distinto del gap ya conocido/aceptado de ImageUploader (cuyo publicId
  // sólo vive en memoria de esta sesión): acá el padre puede pasar el
  // publicId de un video cargado en una sesión ANTERIOR (al reabrir el
  // evento para editarlo), así que reemplazar/eliminar siempre puede
  // limpiar el recurso real en Cloudinary, no sólo el que se acaba de subir
  // ahora mismo.
  publicId: publicIdProp,
  onChange,
  label = "Video",
  helperText = "MP4 recomendado · Máx. 30 segundos · Máx. 100 MB",
  className = "",
  previewHeightClass = "h-72",
}) {
  const { getToken } = useAuth();
  const toast = useToast();
  const inputRef = useRef(null);
  const [preview, setPreview] = useState(value || null);
  const [publicId, setPublicId] = useState(publicIdProp || null);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    setPreview(value || null);
  }, [value]);

  useEffect(() => {
    setPublicId(publicIdProp || null);
  }, [publicIdProp]);

  async function deleteVideoBestEffort(idToDelete) {
    if (!idToDelete) return;
    try {
      const token = await getToken();
      // `?type=video` — mismo endpoint de borrado que ImageUploader.jsx,
      // ver deleteMedia en media.controller.js.
      await apiFetch(`/api/media/${idToDelete}?type=video`, { token, method: "DELETE" });
    } catch (err) {
      // Best-effort: nunca bloquea el flujo principal (subir/reemplazar) por
      // un fallo de limpieza — el recurso queda huérfano en el peor caso,
      // nunca rompe la experiencia del organizador.
      console.error("No se pudo eliminar el video anterior en Cloudinary", err);
    }
  }

  // Reemplazo seguro (ver informe de la ronda): SUBIR primero, actualizar
  // el estado/onChange con el video NUEVO, y sólo DESPUÉS de que la subida
  // terminó bien, borrar el recurso anterior. Nunca al revés — si se
  // borrara el viejo antes de confirmar que el nuevo subió, un upload
  // fallido dejaría el evento sin ningún video.
  async function uploadFile(file) {
    const localPreview = URL.createObjectURL(file);
    const previousPublicId = publicId;
    setPreview(localPreview);
    setUploading(true);
    setError("");

    try {
      const token = await getToken();
      const result = await apiUpload("/api/media/upload-video", { token, file });
      setPreview(result.url);
      setPublicId(result.publicId);
      onChange?.({ url: result.url, publicId: result.publicId });
      toast.success("Video subido correctamente.");

      if (previousPublicId && previousPublicId !== result.publicId) {
        deleteVideoBestEffort(previousPublicId);
      }
    } catch (err) {
      setError(err.message || "No pudimos subir el video. Probá de nuevo.");
      setPreview(value || null);
    } finally {
      setUploading(false);
    }
  }

  function handleFile(file) {
    setError("");
    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }
    uploadFile(file);
  }

  function onInputChange(event) {
    const file = event.target.files?.[0];
    if (file) handleFile(file);
    event.target.value = "";
  }

  function onDrop(event) {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  async function handleRemove(event) {
    event.stopPropagation();
    setError("");

    if (publicId) {
      setRemoving(true);
      await deleteVideoBestEffort(publicId);
      setRemoving(false);
    }

    setPreview(null);
    setPublicId(null);
    onChange?.(null);
    toast.success("Video eliminado.");
  }

  let boxToneClass = "border-white/15 bg-white/5 hover:border-violet-500/60 hover:bg-white/10";
  if (dragActive) boxToneClass = "border-violet-500 bg-violet-500/10";
  else if (preview) boxToneClass = "border-white/10 bg-black/30";

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {label && <span className="text-xs font-medium text-slate-400">{label}</span>}

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
        disabled={uploading}
        className={`group relative flex ${previewHeightClass} w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border border-dashed transition-colors duration-150 ${boxToneClass} disabled:cursor-not-allowed`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="video/mp4,video/quicktime,video/webm"
          className="hidden"
          onChange={onInputChange}
        />

        {preview ? (
          <>
            <video
              src={preview}
              className="absolute inset-0 h-full w-full object-cover"
              muted
              loop
              autoPlay
              playsInline
            />
            <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/50 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
              <span className="text-xs font-medium text-white">
                Click o arrastrá para reemplazar
              </span>
            </div>
            <button
              type="button"
              onClick={handleRemove}
              disabled={removing}
              aria-label="Eliminar video"
              className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white transition-colors duration-150 hover:bg-black/80 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {removing ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
            </button>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 text-slate-400">
            <FileVideo className="h-6 w-6" />
            <p className="text-xs">
              <span className="font-medium text-violet-400">Subí un video</span> o arrastralo acá
            </p>
          </div>
        )}

        {uploading && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/60 text-sm text-white">
            <Loader2 className="h-4 w-4 animate-spin" />
            Subiendo...
          </div>
        )}
      </button>

      {error ? (
        <p className="flex items-center gap-1.5 text-xs text-rose-400">
          <VideoOff className="h-3.5 w-3.5" />
          {error}
        </p>
      ) : (
        <p className="text-xs text-slate-500">{helperText}</p>
      )}
    </div>
  );
}
