# usePolling — infraestructura de datos en vivo

## Qué es

`usePolling(fetcher, options)` es el único mecanismo de "actualización automática" del frontend. No sabe nada de HTTP, de ningún endpoint, ni de ningún dominio de negocio (ventas, scanners, tickets...). Sólo decide **cuándo** llamar a `fetcher`, nunca **cómo** se obtienen los datos.

```js
const { data, loading, error, refetch } = usePolling(fetcher, {
  intervalMs: 10000, // cada cuánto refresca
  enabled: true,     // si hay algo que pedir todavía
  polling: true,     // si además de la carga inicial, hay que repetir
  deps: [algoQueIdentificaQueSePide],
});
```

- `enabled: false` → no hace ningún fetch (ni el inicial), `data` queda en `null`.
- `polling: false` → hace la carga inicial una sola vez, no arma intervalo.
- `deps` cambia → reinicia todo el ciclo desde cero (descarta cualquier respuesta en vuelo del ciclo anterior).
- Un único intervalo activo siempre, Page Visibility API integrada (pausa real al ocultar la pestaña, refresco inmediato + reanudación al volver).

## Las 3 capas, separadas a propósito

```
usePolling            → CUÁNDO refrescar (intervalo, visibilidad, ciclo de vida)
useEventControlRoomData → QUÉ pedir (4 endpoints concretos, con su token/eventId)
OrganizerDashboard.jsx  → CÓMO se ve (sólo consume {sales, tickets, scanners, ...})
```

`useEventControlRoomData` (`pages/organizer/dashboard/useEventControlRoomData.js`) es el ejemplo de referencia: le pasa a `usePolling` un `fetcher` que hace los 4 `Promise.all` de siempre, y expone hacia el Dashboard exactamente el mismo `{sales, tickets, scanners, functionStats, loading, error, refetch}` que exponía antes de existir `usePolling`. El Dashboard no se enteró del cambio.

Cualquier pantalla nueva (Scanner, Ventas, Actividad, Estadísticas, Notificaciones) sigue el mismo patrón: un hook de dominio propio, delgado, que sólo define su `fetcher` y le delega el resto a `usePolling`.

## Migración futura a WebSockets/SSE, sin romper nada

El contrato público que hay que preservar es el que devuelve el hook de **dominio** (`useEventControlRoomData` y los que vengan después): `{ data-fields..., loading, error, refetch }`. Mientras ese contrato no cambie, a `OrganizerDashboard.jsx` (o a cualquier componente) no le importa qué motor hay detrás.

Pasos para migrar cuando llegue el momento:

1. **Crear un hook motor nuevo**, por ejemplo `useLiveChannel(topic, options)`, que en vez de `setInterval` abra una conexión WS/SSE y escuche mensajes de ese `topic`. Debe devolver la **misma forma**: `{ data, loading, error, refetch }` (acá `refetch` pasa a significar "forzar una resincronización manual", no "volver a pedir por HTTP").
2. **Cambiar únicamente el hook de dominio** para que llame a `useLiveChannel` en vez de a `usePolling` — una línea de import y una llamada distinta, nada más. `fetcher` deja de existir como tal; se reemplaza por la lógica de qué `topic` suscribir y cómo mapear el mensaje entrante a la misma forma de datos que ya devolvía el `fetcher` original.
3. **Nada por fuera del hook de dominio cambia.** `OrganizerDashboard.jsx`, `ActivityTimeline`, `ScannerStatusList`, `FunctionOccupancyList` no se tocan: siguen recibiendo props con la misma forma que siempre.
4. `usePolling` no desaparece necesariamente: puede convivir como fallback (reconexión de WS caída → volver a polling temporalmente) o quedar sólo para las pantallas que todavía no migraron.

Lo que **sí** es exclusivo del motor WS/SSE y nunca debería filtrarse a los hooks de dominio ni a los componentes: manejo de conexión/reconexión, backoff, parseo de mensajes, y el ruteo de "a qué topic corresponde este mensaje". Todo eso vive dentro de `useLiveChannel`, igual que hoy el `setInterval`/Page Visibility viven enteramente dentro de `usePolling` y en ningún otro lado.

## Qué NO hace este hook (a propósito)

- No cachea entre distintos componentes que pidan lo mismo (cada llamada a `usePolling` es independiente). Si hace falta compartir una misma suscripción entre varias pantallas, es una capa aparte por construir cuando haga falta — no está resuelta acá.
- No expone `pause()`/`resume()` imperativos: el control es 100% vía las props `enabled`/`polling`, controladas por el caller (mismo patrón que un componente controlado). Evita un estado interno que pueda desincronizarse de lo que el caller cree que está pasando.
