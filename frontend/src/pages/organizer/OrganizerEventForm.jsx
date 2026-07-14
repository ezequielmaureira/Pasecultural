import { useMemo, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { ImageIcon, Plus, Trash2 } from "lucide-react";
import Card from "../../components/ui/Card.jsx";
import Button from "../../components/ui/Button.jsx";
import { Field, inputClass, textareaClass } from "../../components/ui/FormField.jsx";
import { useOrganizerData } from "../../context/OrganizerDataContext.jsx";
import {
  CATEGORIES,
  CURRENCIES,
  EVENT_STATUS,
  createEmptyEvent,
  createEmptyTicketType,
} from "../../data/organizerMockData.js";

export default function OrganizerEventForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { events, addEvent, updateEvent } = useOrganizerData();
  const isEditing = Boolean(id);

  const existing = useMemo(
    () => events.find((event) => event.id === id),
    [events, id]
  );

  const [form, setForm] = useState(() => existing ?? createEmptyEvent());

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function addTicketType() {
    setForm((prev) => ({
      ...prev,
      ticketTypes: [...prev.ticketTypes, createEmptyTicketType()],
    }));
  }

  function updateTicketType(ttId, patch) {
    setForm((prev) => ({
      ...prev,
      ticketTypes: prev.ticketTypes.map((tt) =>
        tt.id === ttId ? { ...tt, ...patch } : tt
      ),
    }));
  }

  function removeTicketType(ttId) {
    setForm((prev) => ({
      ...prev,
      ticketTypes: prev.ticketTypes.filter((tt) => tt.id !== ttId),
    }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (isEditing) {
      updateEvent(id, form);
    } else {
      addEvent(form);
    }
    navigate("/organizador/eventos");
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">
            {isEditing ? "Editar evento" : "Crear evento"}
          </h1>
          <p className="text-sm text-slate-400">
            Completá los datos de tu evento
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/organizador/eventos">
            <Button type="button" variant="secondary">
              Cancelar
            </Button>
          </Link>
          <Button type="submit">Guardar evento</Button>
        </div>
      </div>

      <Card title="Información general">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Nombre" className="sm:col-span-2">
            <input
              className={inputClass}
              value={form.name}
              onChange={(e) => setField("name", e.target.value)}
              placeholder="Ej: Rock Nacional"
              required
            />
          </Field>
          <Field label="Descripción" className="sm:col-span-2">
            <textarea
              className={textareaClass}
              value={form.description}
              onChange={(e) => setField("description", e.target.value)}
              placeholder="Contale al público de qué se trata el evento"
            />
          </Field>
          <Field label="Categoría">
            <select
              className={inputClass}
              value={form.category}
              onChange={(e) => setField("category", e.target.value)}
            >
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat} className="bg-[#0B1120]">
                  {cat}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Estado">
            <select
              className={inputClass}
              value={form.status}
              onChange={(e) => setField("status", e.target.value)}
            >
              {Object.values(EVENT_STATUS).map((status) => (
                <option key={status} value={status} className="bg-[#0B1120]">
                  {status}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Card>

      <Card title="Imágenes">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="flex aspect-video flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-white/15 text-slate-500 sm:col-span-2">
            <ImageIcon className="h-5 w-5" />
            <span className="text-xs">Imagen principal</span>
          </div>
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="flex aspect-video flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-white/10 text-slate-600"
            >
              <ImageIcon className="h-4 w-4" />
              <span className="text-[11px]">Galería</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-500">
          La carga de imágenes estará disponible próximamente.
        </p>
      </Card>

      <Card title="Fecha y lugar">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Fecha">
            <input
              type="date"
              className={inputClass}
              value={form.date}
              onChange={(e) => setField("date", e.target.value)}
              required
            />
          </Field>
          <Field label="Hora">
            <input
              type="time"
              className={inputClass}
              value={form.time}
              onChange={(e) => setField("time", e.target.value)}
              required
            />
          </Field>
          <Field label="Lugar">
            <input
              className={inputClass}
              value={form.venue}
              onChange={(e) => setField("venue", e.target.value)}
              placeholder="Ej: Teatro del Libertador"
            />
          </Field>
          <Field label="Dirección">
            <input
              className={inputClass}
              value={form.address}
              onChange={(e) => setField("address", e.target.value)}
              placeholder="Calle y número, ciudad"
            />
          </Field>
          <Field label="Google Maps" className="sm:col-span-2">
            <input
              className={inputClass}
              value={form.mapsUrl}
              onChange={(e) => setField("mapsUrl", e.target.value)}
              placeholder="https://maps.google.com/..."
            />
          </Field>
        </div>
      </Card>

      <Card title="Capacidad y precio">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <Field label="Capacidad máxima">
            <input
              type="number"
              min="0"
              className={inputClass}
              value={form.capacity}
              onChange={(e) => setField("capacity", e.target.value)}
            />
          </Field>
          <Field label="Edad mínima">
            <input
              type="number"
              min="0"
              className={inputClass}
              value={form.minAge}
              onChange={(e) => setField("minAge", e.target.value)}
            />
          </Field>
          <Field label="Precio base">
            <input
              type="number"
              min="0"
              className={inputClass}
              value={form.price}
              onChange={(e) => setField("price", e.target.value)}
            />
          </Field>
          <Field label="Moneda">
            <select
              className={inputClass}
              value={form.currency}
              onChange={(e) => setField("currency", e.target.value)}
            >
              {CURRENCIES.map((cur) => (
                <option key={cur} value={cur} className="bg-[#0B1120]">
                  {cur}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Card>

      <Card title="Política y datos adicionales">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Política de devolución">
            <textarea
              className={textareaClass}
              value={form.refundPolicy}
              onChange={(e) => setField("refundPolicy", e.target.value)}
              placeholder="Ej: Reembolso completo hasta 48hs antes"
            />
          </Field>
          <Field label="Información adicional">
            <textarea
              className={textareaClass}
              value={form.extraInfo}
              onChange={(e) => setField("extraInfo", e.target.value)}
              placeholder="Requisitos de ingreso, recomendaciones, etc."
            />
          </Field>
        </div>
      </Card>

      <Card title="Tipos de entrada">
        <div className="flex flex-col gap-4">
          {form.ticketTypes.map((tt) => (
            <div
              key={tt.id}
              className="grid grid-cols-2 gap-3 rounded-lg border border-white/10 p-4 sm:grid-cols-6"
            >
              <Field label="Nombre" className="sm:col-span-2">
                <input
                  className={inputClass}
                  value={tt.name}
                  onChange={(e) =>
                    updateTicketType(tt.id, { name: e.target.value })
                  }
                  placeholder="General, VIP..."
                />
              </Field>
              <Field label="Precio">
                <input
                  type="number"
                  min="0"
                  className={inputClass}
                  value={tt.price}
                  onChange={(e) =>
                    updateTicketType(tt.id, { price: e.target.value })
                  }
                />
              </Field>
              <Field label="Stock">
                <input
                  type="number"
                  min="0"
                  className={inputClass}
                  value={tt.stock}
                  onChange={(e) =>
                    updateTicketType(tt.id, { stock: e.target.value })
                  }
                />
              </Field>
              <Field label="Color">
                <input
                  type="color"
                  className="h-10 w-full rounded-lg border border-white/10 bg-white/5 px-1"
                  value={tt.color}
                  onChange={(e) =>
                    updateTicketType(tt.id, { color: e.target.value })
                  }
                />
              </Field>
              <Field label="Orden">
                <input
                  type="number"
                  min="1"
                  className={inputClass}
                  value={tt.order}
                  onChange={(e) =>
                    updateTicketType(tt.id, { order: e.target.value })
                  }
                />
              </Field>
              <Field label="Descripción" className="sm:col-span-5">
                <input
                  className={inputClass}
                  value={tt.description}
                  onChange={(e) =>
                    updateTicketType(tt.id, { description: e.target.value })
                  }
                  placeholder="Detalle breve para el comprador"
                />
              </Field>
              <div className="flex items-end justify-between gap-2">
                <label className="flex items-center gap-2 text-xs text-slate-400">
                  <input
                    type="checkbox"
                    checked={tt.visible}
                    onChange={(e) =>
                      updateTicketType(tt.id, { visible: e.target.checked })
                    }
                    className="h-4 w-4 rounded border-white/20 bg-white/5 text-violet-500"
                  />
                  Visible
                </label>
                <button
                  type="button"
                  onClick={() => removeTicketType(tt.id)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors duration-150 hover:bg-white/5 hover:text-rose-400"
                  title="Quitar tipo de entrada"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}

          <Button
            type="button"
            variant="secondary"
            className="self-start"
            onClick={addTicketType}
          >
            <Plus className="h-4 w-4" />
            Agregar tipo de entrada
          </Button>
        </div>
      </Card>
    </form>
  );
}
