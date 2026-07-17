import { useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { ImagePlus, X, Loader2, ImageOff } from "lucide-react";
import { apiUpload, apiFetch } from "../../lib/api.js";

const ACCEPTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_FILE_SIZE = 5 * 1024 * 1024;

function validateFile(file) {
  if (!ACCEPTED_TYPES.has(file.type)) {
    return "Formato no soportado. Usá PNG, JPG, JPEG o WEBP.";
  }
  if (file.size > MAX_FILE_SIZE) {
    return "La imagen no puede superar los 5 MB.";
  }
  return null;
}

export default function ImageUploader({
  value,
  onChange,
  label = "Imagen",
  helperText = "PNG, JPG, JPEG o WEBP. Máximo 5 MB.",
  className = "",
  previewHeightClass = "h-40",
}) {
  const { getToken } = useAuth();
  const inputRef = useRef(null);
  const [preview, setPreview] = useState(value || null);
  const [publicId, setPublicId] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    setPreview(value || null);
  }, [value]);

  async function handleFile(file) {
    setError("");

    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    const localPreview = URL.createObjectURL(file);
    setPreview(localPreview);
    setUploading(true);

    try {
      const token = await getToken();
      const result = await apiUpload("/api/media/upload", { token, file });
      setPreview(result.url);
      setPublicId(result.publicId);
      onChange?.(result.url);
    } catch (err) {
      setError(err.message || "No pudimos subir la imagen. Probá de nuevo.");
      setPreview(value || null);
    } finally {
      setUploading(false);
    }
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
      try {
        const token = await getToken();
        await apiFetch(`/api/media/${publicId}`, { token, method: "DELETE" });
      } catch (err) {
        console.error("No se pudo eliminar la imagen en Cloudinary", err);
      }
    }

    setPreview(null);
    setPublicId(null);
    onChange?.(null);
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
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={onInputChange}
        />

        {preview ? (
          <>
            <img
              src={preview}
              alt="Vista previa"
              className="absolute inset-0 h-full w-full object-contain"
            />
            <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/50 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
              <span className="text-xs font-medium text-white">
                Click o arrastrá para reemplazar
              </span>
            </div>
            <button
              type="button"
              onClick={handleRemove}
              aria-label="Eliminar imagen"
              className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white transition-colors duration-150 hover:bg-black/80"
            >
              <X className="h-4 w-4" />
            </button>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 text-slate-400">
            <ImagePlus className="h-6 w-6" />
            <p className="text-xs">
              <span className="font-medium text-violet-400">Subí una imagen</span> o
              arrastrala acá
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
          <ImageOff className="h-3.5 w-3.5" />
          {error}
        </p>
      ) : (
        <p className="text-xs text-slate-500">{helperText}</p>
      )}
    </div>
  );
}
