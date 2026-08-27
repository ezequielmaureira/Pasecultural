import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { getPublicLaunchStatus } from "../../lib/publicLaunchApi.js";
import ComingSoon from "../../pages/public/ComingSoon.jsx";

// Modo Prelanzamiento — envuelve EXCLUSIVAMENTE las rutas públicas
// comerciales (Home, listado/detalle de eventos, compra, mis entradas,
// recuperación, arrepentimiento — ver App.jsx). Nunca envuelve
// /iniciar-sesion, /registro, páginas legales, ni nada detrás de
// RequireAuth: ese es justamente el camino que Developer/Organizer
// necesitan conservar siempre disponible.
//
// Bloquea sin excepción de rol a propósito (mismo criterio que el guard
// backend en event.routes.js): ni Developer ni Organizer necesitan
// navegar el marketplace público bloqueado durante las pruebas — tienen
// sus propias áreas internas para eso. Si alguna vez hiciera falta
// previsualizar el sitio público en vivo, la forma correcta es habilitarlo
// temporalmente desde Developer > Configuración, nunca un bypass de rol
// nuevo acá.
//
// Fail-closed también del lado del cliente: si la consulta falla (red,
// timeout), se trata como bloqueado — nunca se asume "abierto" por un
// error de carga. La fuente de verdad sigue siendo siempre el backend
// (ver publicLaunchSettings.service.js); esto es sólo UX, no la
// protección real.
export default function PreLaunchGate() {
  const [status, setStatus] = useState("loading"); // "loading" | "blocked" | "allowed"

  useEffect(() => {
    let cancelled = false;

    getPublicLaunchStatus()
      .then(({ publicLaunchEnabled }) => {
        if (!cancelled) setStatus(publicLaunchEnabled ? "allowed" : "blocked");
      })
      .catch((err) => {
        console.error("No se pudo consultar el estado público de PaseCultural", err);
        if (!cancelled) setStatus("blocked");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#05070B] text-sm text-slate-400">
        Cargando...
      </div>
    );
  }

  if (status === "blocked") {
    return <ComingSoon />;
  }

  return <Outlet />;
}
