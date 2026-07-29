import { useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { ImagePlus, X, Loader2, ImageOff, Move, Check } from "lucide-react";
import { apiUpload, apiFetch } from "../../lib/api.js";

const ACCEPTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const OUTPUT_WIDTH = 1000;
const MAX_ZOOM = 3;

function validateFile(file) {
  if (!ACCEPTED_TYPES.has(file.type)) {
    return "Formato no soportado. Usá PNG, JPG, JPEG o WEBP.";
  }
  if (file.size > MAX_FILE_SIZE) {
    return "La imagen no puede superar los 5 MB.";
  }
  return null;
}

// Encuadre interactivo: el usuario arrastra y hace zoom sobre su foto dentro
// de un marco con la proporción final de la card/flyer, y al confirmar se
// recorta a un canvas del lado del cliente. No cambia el contrato de subida
// (sigue yendo un solo archivo ya compuesto a /api/media/upload).
function CropEditor({ file, aspectRatio, onCancel, onConfirm }) {
  const frameRef = useRef(null);
  const imgRef = useRef(null);
  const dragRef = useRef(null);
  const [imgUrl] = useState(() => URL.createObjectURL(file));
  const [natural, setNatural] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  useEffect(() => () => URL.revokeObjectURL(imgUrl), [imgUrl]);

  function getGeometry() {
    const frame = frameRef.current;
    if (!frame || !natural) return null;
    const { width: cw, height: ch } = frame.getBoundingClientRect();
    const baseScale = Math.max(cw / natural.w, ch / natural.h);
    const scale = baseScale * zoom;
    const renderedW = natural.w * scale;
    const renderedH = natural.h * scale;
    const maxOffsetX = Math.max(0, (renderedW - cw) / 2);
    const maxOffsetY = Math.max(0, (renderedH - ch) / 2);
    return { cw, ch, scale, renderedW, renderedH, maxOffsetX, maxOffsetY };
  }

  function clamp(value, max) {
    return Math.max(-max, Math.min(max, value));
  }

  function handlePointerDown(event) {
    event.preventDefault();
    dragRef.current = { startX: event.clientX, startY: event.clientY, origin: offset };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event) {
    if (!dragRef.current) return;
    const geometry = getGeometry();
    if (!geometry) return;
    const dx = event.clientX - dragRef.current.startX;
    const dy = event.clientY - dragRef.current.startY;
    setOffset({
      x: clamp(dragRef.current.origin.x + dx, geometry.maxOffsetX),
      y: clamp(dragRef.current.origin.y + dy, geometry.maxOffsetY),
    });
  }

  function handlePointerUp(event) {
    dragRef.current = null;
    setDragging(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function handleZoomChange(nextZoom) {
    setZoom(nextZoom);
    const frame = frameRef.current;
    if (!frame || !natural) return;
    const { width: cw, height: ch } = frame.getBoundingClientRect();
    const baseScale = Math.max(cw / natural.w, ch / natural.h);
    const scale = baseScale * nextZoom;
    const maxOffsetX = Math.max(0, (natural.w * scale - cw) / 2);
    const maxOffsetY = Math.max(0, (natural.h * scale - ch) / 2);
    setOffset((prev) => ({
      x: clamp(prev.x, maxOffsetX),
      y: clamp(prev.y, maxOffsetY),
    }));
  }

  function handleConfirm() {
    const geometry = getGeometry();
    if (!geometry) return;
    const outputHeight = Math.round(OUTPUT_WIDTH / aspectRatio);
    const k = OUTPUT_WIDTH / geometry.cw;

    const left = (geometry.cw - geometry.renderedW) / 2 + offset.x;
    const top = (geometry.ch - geometry.renderedH) / 2 + offset.y;

    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT_WIDTH;
    canvas.height = outputHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(
      imgRef.current,
      0,
      0,
      natural.w,
      natural.h,
      left * k,
      top * k,
      geometry.renderedW * k,
      geometry.renderedH * k
    );

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const croppedFile = new File([blob], file.name.replace(/\.\w+$/, ".jpg"), {
          type: "image/jpeg",
        });
        onConfirm(croppedFile);
      },
      "image/jpeg",
      0.92
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="flex w-full max-w-sm flex-col gap-3 rounded-xl border border-white/10 bg-[#0B1120] p-4">
        <p className="flex items-center gap-1.5 text-sm font-medium text-white">
          <Move className="h-4 w-4 text-violet-400" />
          Elegí cómo se va a ver tu imagen
        </p>

        <div
          ref={frameRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className={`relative mx-auto w-full max-w-[260px] touch-none select-none overflow-hidden rounded-lg bg-black/40 ${
            dragging ? "cursor-grabbing" : "cursor-grab"
          }`}
          style={{ aspectRatio }}
        >
          <img
            ref={imgRef}
            src={imgUrl}
            alt=""
            draggable={false}
            onLoad={(e) => setNatural({ w: e.target.naturalWidth, h: e.target.naturalHeight })}
            className="pointer-events-none absolute left-1/2 top-1/2 max-w-none"
            style={{
              transform: natural
                ? `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) scale(${
                    Math.max(
                      (frameRef.current?.getBoundingClientRect().width ?? 260) / natural.w,
                      (frameRef.current?.getBoundingClientRect().height ?? 260 / aspectRatio) /
                        natural.h
                    ) * zoom
                  })`
                : undefined,
              width: natural ? `${natural.w}px` : undefined,
              height: natural ? `${natural.h}px` : undefined,
            }}
          />
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400">Zoom</span>
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.05}
            value={zoom}
            onChange={(e) => handleZoomChange(Number(e.target.value))}
            className="h-1.5 flex-1 accent-violet-500"
          />
        </div>
        <p className="text-xs text-slate-500">Arrastrá la imagen para elegir la posición.</p>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-2 text-sm font-medium text-slate-300 transition-colors duration-150 hover:bg-white/5 hover:text-white"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!natural}
            className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Check className="h-4 w-4" />
            Aplicar
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ImageUploader({
  value,
  onChange,
  label = "Imagen",
  helperText = "PNG, JPG, JPEG o WEBP. Máximo 5 MB.",
  className = "",
  previewHeightClass = "h-40",
  aspectRatio = null,
}) {
  const { getToken } = useAuth();
  const inputRef = useRef(null);
  const [preview, setPreview] = useState(value || null);
  const [publicId, setPublicId] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [cropFile, setCropFile] = useState(null);

  useEffect(() => {
    setPreview(value || null);
  }, [value]);

  async function uploadFile(file) {
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

  function handleFile(file) {
    setError("");

    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    if (aspectRatio) {
      setCropFile(file);
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
              className={`absolute inset-0 h-full w-full ${
                aspectRatio ? "object-cover" : "object-contain"
              }`}
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

      {cropFile && (
        <CropEditor
          file={cropFile}
          aspectRatio={aspectRatio}
          onCancel={() => setCropFile(null)}
          onConfirm={(croppedFile) => {
            setCropFile(null);
            uploadFile(croppedFile);
          }}
        />
      )}
    </div>
  );
}
