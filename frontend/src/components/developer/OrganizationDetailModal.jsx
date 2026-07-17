import {
  Check,
  X as XIcon,
  Globe,
  Mail,
  Phone,
  Building2,
  MapPin,
  AtSign,
  Link2,
  IdCard,
} from "lucide-react";
import Modal from "../ui/Modal.jsx";
import Button from "../ui/Button.jsx";
import Avatar from "../ui/Avatar.jsx";
import {
  ORG_STATUS_LABEL,
  ORG_STATUS_STYLES,
} from "../../lib/organizationStatus.js";
import { ORGANIZATION_TYPE_LABEL } from "../../lib/organizationTypes.js";

function ChecklistItem({ label, done }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
          done ? "bg-emerald-500/15 text-emerald-400" : "bg-white/5 text-slate-600"
        }`}
      >
        {done ? <Check className="h-3.5 w-3.5" /> : <XIcon className="h-3.5 w-3.5" />}
      </span>
      <span className={done ? "text-slate-200" : "text-slate-500"}>{label}</span>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
      <div className="min-w-0">
        <p className="text-xs text-slate-500">{label}</p>
        <p className="truncate text-sm text-slate-200">{value || "—"}</p>
      </div>
    </div>
  );
}

function buildChecklist(organization) {
  return [
    { label: "Nombre", done: Boolean(organization.name) },
    {
      label: "Responsable",
      done: Boolean(
        organization.responsibleFirstName && organization.responsibleLastName
      ),
    },
    { label: "Email", done: Boolean(organization.email) },
    { label: "Teléfono", done: Boolean(organization.phone) },
    { label: "Tipo", done: Boolean(organization.type) },
    { label: "Ciudad", done: Boolean(organization.city) },
    { label: "Provincia", done: Boolean(organization.province) },
    { label: "Logo", done: Boolean(organization.logo) },
    { label: "Descripción", done: Boolean(organization.description) },
    { label: "Sitio web", done: Boolean(organization.website) },
    {
      label: "CUIT o DNI",
      done: Boolean(organization.cuit || organization.responsibleDni),
    },
  ];
}

export default function OrganizationDetailModal({
  organization,
  onClose,
  onChangeStatus,
  onDelete,
  updating,
}) {
  if (!organization) return null;

  const owner = organization.owner;
  const responsibleName = [
    organization.responsibleFirstName,
    organization.responsibleLastName,
  ]
    .filter(Boolean)
    .join(" ");
  const ownerName = [owner?.firstName, owner?.lastName].filter(Boolean).join(" ");

  const checklist = buildChecklist(organization);
  const completion = Math.round(
    (checklist.filter((item) => item.done).length / checklist.length) * 100
  );

  return (
    <Modal title="Detalle de la organización" onClose={onClose} maxWidth="max-w-2xl">
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-4">
          <Avatar
            src={organization.logo}
            name={organization.name}
            size="lg"
            className="bg-gradient-to-br from-violet-500 to-blue-500 text-white"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-semibold text-white">
              {organization.name}
            </p>
            <p className="truncate text-sm text-slate-400">
              {ORGANIZATION_TYPE_LABEL[organization.type] ?? "Sin tipo"}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
              ORG_STATUS_STYLES[organization.status] ?? "bg-white/10 text-slate-400"
            }`}
          >
            {ORG_STATUS_LABEL[organization.status] ?? organization.status}
          </span>
        </div>

        {organization.description && (
          <p className="text-sm text-slate-300">{organization.description}</p>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <InfoRow icon={Mail} label="Email" value={organization.email} />
          <InfoRow icon={Phone} label="Teléfono" value={organization.phone} />
          <InfoRow
            icon={MapPin}
            label="Ubicación"
            value={
              [organization.city, organization.province].filter(Boolean).join(", ") ||
              null
            }
          />
          <InfoRow icon={Globe} label="Sitio web" value={organization.website} />
          <InfoRow icon={AtSign} label="Instagram" value={organization.instagram} />
          <InfoRow
            icon={Link2}
            label="Facebook / TikTok"
            value={
              [organization.facebook, organization.tiktok].filter(Boolean).join(" · ") ||
              null
            }
          />
          <InfoRow icon={Building2} label="CUIT" value={organization.cuit} />
          <InfoRow icon={IdCard} label="DNI del responsable" value={organization.responsibleDni} />
          <InfoRow icon={Mail} label="Responsable" value={responsibleName || ownerName || owner?.email} />
          <InfoRow
            icon={Building2}
            label="Fecha de creación"
            value={new Date(organization.createdAt).toLocaleDateString("es-AR")}
          />
          {organization.approvedAt && (
            <InfoRow
              icon={Check}
              label="Fecha de aprobación"
              value={new Date(organization.approvedAt).toLocaleDateString("es-AR")}
            />
          )}
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Perfil completo
            </p>
            <p className="text-sm font-semibold text-white">{completion}%</p>
          </div>
          <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-violet-500 to-blue-500 transition-all duration-300"
              style={{ width: `${completion}%` }}
            />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {checklist.map((item) => (
              <ChecklistItem key={item.label} {...item} />
            ))}
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-white/10 pt-4">
          <Button variant="ghost" onClick={onClose} disabled={updating}>
            Cancelar
          </Button>
          <Button
            variant="secondary"
            onClick={() => onChangeStatus(organization.id, "SUSPENDED")}
            disabled={updating || organization.status === "SUSPENDED"}
          >
            Suspender
          </Button>
          <Button
            variant="secondary"
            className="bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
            onClick={() => onChangeStatus(organization.id, "REJECTED")}
            disabled={updating || organization.status === "REJECTED"}
          >
            Rechazar
          </Button>
          <Button
            onClick={() => onChangeStatus(organization.id, "APPROVED")}
            disabled={updating || organization.status === "APPROVED"}
          >
            {organization.status === "SUSPENDED" || organization.status === "REJECTED"
              ? "Reactivar"
              : "Aprobar"}
          </Button>
          <Button
            className="bg-rose-600 text-white hover:bg-rose-500"
            onClick={() => onDelete(organization)}
            disabled={updating}
          >
            Eliminar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
