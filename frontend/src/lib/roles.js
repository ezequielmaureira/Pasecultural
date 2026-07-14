export const ROLES = [
  { id: "developer", label: "Developer" },
  { id: "organizer", label: "Organizador" },
  { id: "scanner", label: "Scanner" },
  { id: "customer", label: "Usuario" },
];

export const ROLE_HOME = {
  developer: "/developer",
  organizer: "/organizador",
  scanner: "/scanner",
  customer: "/usuario",
};

export function roleFromPath(pathname) {
  if (pathname.startsWith("/organizador")) return "organizer";
  if (pathname.startsWith("/scanner")) return "scanner";
  if (pathname.startsWith("/usuario")) return "customer";
  return "developer";
}
