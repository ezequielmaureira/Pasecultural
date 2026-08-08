# INFORME TÉCNICO MAESTRO — PaseCultural

Documento de estado real del proyecto, basado exclusivamente en el código presente en el repositorio al momento de escribirlo. No es un documento de planificación ni de opinión: describe lo que existe, cómo funciona y qué falta, tal como está implementado hoy.

---

## 1. RESUMEN GENERAL

**Objetivo de la aplicación.** PaseCultural es una plataforma de venta y administración de entradas para eventos culturales (teatro, música, centros culturales, productoras independientes). Cubre todo el ciclo: un organizador crea y publica un evento con sus funciones y tipos de entrada, el público compra sin necesidad de crear una cuenta, cada entrada se emite como un ticket individual con QR cifrado, el ingreso se controla en la puerta con una app de "Scanner" operada por personal sin cuenta de usuario tradicional, y el organizador (o el equipo de PaseCultural, rol "Developer") administra todo desde paneles propios.

**Arquitectura general.** Monorepo con dos carpetas independientes y sin capa intermedia: `backend` (API REST) y `frontend` (SPA), que se comunican directo por HTTP/JSON. No hay SSR, no hay BFF, no hay microservicios: es una API monolítica y un cliente SPA.

**Tecnologías utilizadas — Frontend:** React 19, Vite 8, React Router 7, Tailwind CSS 4, Clerk (`@clerk/clerk-react` + `@clerk/localizations` para español), Google Maps JS API (`@googlemaps/js-api-loader`), `qrcode.react` (render de QR), `qr-scanner` (lectura de QR por cámara, módulo Scanner), `jspdf` (generación de PDF de entradas en el navegador), `lucide-react` (iconografía). Sin librería de manejo de estado global (ni Redux ni Zustand ni similar — todo con Context de React + `useState`/`useEffect`), sin librería de formularios, sin librería de componentes UI de terceros (todo el sistema de diseño es propio, sobre Tailwind), sin `html2canvas`, sin i18n propio (textos en español hardcodeados; sólo la UI de Clerk está localizada), sin SDK de analítica/monitoreo, sin infraestructura de testing (no hay Jest/Vitest/Testing Library instalado).

**Tecnologías utilizadas — Backend:** Node.js con Express 5 (ESM puro, `type: module`), Prisma 6 como ORM sobre PostgreSQL, `@clerk/express` para autenticación de usuarios con cuenta, `jsonwebtoken` (JWT propio, sólo para sesiones de Scanner), `bcrypt` (no usado para contraseñas de usuario —Clerk las maneja— sino como parte de la infraestructura de hashing del módulo Scanner/verificación), `resend` (envío de email transaccional), `cloudinary` (imágenes), `pdfkit` (PDF de entradas del lado servidor, para el link público de recuperación), `qrcode` (generación de imágenes QR para los emails), `multer` (upload de archivos), `pg` (driver Postgres). Sin framework de testing, sin linter configurado, sin TypeScript.

**Base de datos.** PostgreSQL, gestionada enteramente por Prisma (schema versionado + migraciones SQL generadas). 26 migraciones aplicadas a la fecha de este informe, desde el modelo inicial de usuarios/organizaciones hasta el refactor más reciente de auditoría de entradas y check-ins históricos.

**Servicios externos integrados:** Clerk (autenticación y gestión de cuentas de compradores registrados, organizadores y developer), Resend (todos los emails transaccionales), Cloudinary (imágenes de portada de evento y logo de organización), Google Maps JavaScript API (autocompletar direcciones, mapas de ubicación). **Mercado Pago NO está integrado** — ver secciones 7 y 14, es la ausencia más importante del proyecto.

---

## 2. MÓDULOS

Para cada módulo: objetivo, estado, % aproximado, funcionalidades implementadas y pendientes.

### Autenticación
**Objetivo:** identificar quién es cada usuario y qué puede hacer. **Estado: completo para su alcance actual.** **~95%.**
Implementado: login/registro delegado 100% a los componentes prebuilt de Clerk; sincronización on-demand de la sesión de Clerk a una fila `User` propia (`POST /api/auth/sync`, sin webhook de Clerk); "adopción" automática de compras de invitado previas cuando alguien se registra con el mismo email que usó para comprar sin cuenta; asignación de rol `DEVELOPER` por lista hardcodeada de emails en el código; promoción automática a `ORGANIZER` al crear una organización; roles `DEVELOPER/ORGANIZER/SCANNER/CUSTOMER`; suspensión de cuenta por Developer. El módulo Scanner tiene su **propio** sistema de autenticación, completamente separado de Clerk (JWT propio, ver módulo Scanners). Pendiente: no hay webhook de Clerk (`user.created`, etc.) — la sincronización depende de que el frontend llame a `/api/auth/sync` después de cada login; no hay flujo de "olvidé mi contraseña" propio (lo maneja Clerk); el rol `SCANNER` del enum `Role` de `User` está prácticamente en desuso (los scanners reales son filas `EventScanner`, no `User`).

### Organizaciones
**Objetivo:** que una entidad (teatro, productora, etc.) pueda operar como organizador. **Estado: completo.** **~90%.**
Implementado: alta de organización (una por usuario, auto-promueve a `ORGANIZER`), edición de datos propios, baja propia, listado/detalle/aprobación/rechazo/suspensión por Developer, bloqueo de publicación de eventos si la organización no está `APPROVED`. Pendiente: no hay verificación de identidad más allá de los campos de texto que carga el propio organizador (CUIT, responsable, etc. — nada se valida contra un padrón externo); no hay onboarding de datos de cobro (ver Mercado Pago).

### Eventos
**Objetivo:** que un organizador arme y publique un evento con sus funciones y entradas. **Estado: completo, con DOS flujos de creación/edición redundantes en paralelo.** **~90%.**
Implementado: CRUD completo (crear/listar/editar/eliminar/publicar/despublicar/cancelar), motor conversacional tipo "chat" para crear eventos paso a paso (con posibilidad de retomar, editar cualquier sección desde una vista previa, y guardar como borrador), wizard clásico de formulario para editar eventos ya creados, programación de funciones (fecha única, rango, días de la semana, recurrencia), catálogo de tipos de entrada con overrides por función, enlaces del evento (redes/video, con detección automática de plataforma), ubicación con Google Maps, listado público con filtros (categoría, texto, fecha, gratis/pago, orden), detalle público por slug. Reglas de publicación (requiere organización aprobada, ubicación completa, al menos una función, al menos un tipo de entrada con precio y stock, cada función con al menos una asignación de entradas habilitada). Pendiente: el canal WhatsApp del motor conversacional está declarado en el modelo de datos (`ConversationChannel.WHATSAPP`) pero no tiene ningún adaptador implementado — sólo funciona por web; no hay reordenamiento manual de eventos en el listado del organizador más allá del orden por fecha de creación.

### Tipos de entradas
**Objetivo:** catálogo de tipos de entrada (General, VIP, etc.) por evento, con precio/stock/visibilidad, y sus asignaciones por función. **Estado: funcional, con una pantalla de sólo lectura desactualizada.** **~80%.**
Implementado: alta/edición/baja de tipos de entrada, overrides de precio/stock/visibilidad por función, catálogo dentro del wizard/chat de evento. Pendiente: la pantalla dedicada del organizador ("Tipos de entrada", ex-"Entradas") muestra la columna "Vendidas" **hardcodeada en 0** para toda fila, sin conectar a ningún dato real — no refleja ventas reales.

### Cortesías
**Objetivo:** que el organizador emita entradas sin costo (sponsors, prensa, invitados, staff, artistas, familiares) sin mezclarlas con la venta real. **Estado: completo.** **~90%.**
Implementado: módulo propio dentro del panel de organizador (`/organizador/cortesias`), separado de "Entradas"/"Ventas"; asistente de 6 pasos (evento → función → tipo de entrada del catálogo existente, nunca uno nuevo → cantidad → motivo opcional [Sponsor/Prensa/Invitado/Staff/Artista/Familiar/Protocolo/Otro] + nota libre → entrega por "Compartir" o "Enviar por correo"); "Compartir" reutiliza exactamente la misma infraestructura de invitación del Scanner (Web Share API con fallback a copiar link/WhatsApp/QR); "Enviar por correo" dispara el mismo email de confirmación que recibe un comprador real, sin ningún template paralelo; la emisión reutiliza el mismo flujo de venta confirmada de punta a punta (mismo `Ticket`, mismo QR cifrado, mismo PDF, mismo Scanner) — la única diferencia funcional es `origin = COURTESY` en vez de `SALE` y precio 0; historial con filtros (evento/estado/motivo), estado derivado en vivo (nunca almacenado) y acciones por fila (compartir de nuevo, reenviar por correo, descargar PDF, copiar link, cancelar); estadísticas de cortesías (emitidas/utilizadas/pendientes/canceladas) integradas en "Estado de Funciones"; auditoría completa por emisión (quién, cuándo, evento, función, motivo, cantidad, email de destino si aplica, método de entrega). Restringido a roles `ORGANIZER`/`DEVELOPER`. Pendiente: un `DEVELOPER` no puede cancelar una cortesía de una organización que no es la propia (limitación heredada de `ticketAdmin.service.js`, no ampliada a propósito); el historial no tiene todavía un filtro visible por canal de emisión, aunque la estructura de datos (`Ticket.origin`) ya lo permite sin cambios de arquitectura.

### Compra
**Objetivo:** que cualquier persona pueda comprar entradas sin necesidad de crear una cuenta. **Estado: completo como flujo de checkout, sin pasarela de pago real.** **~75%** (100% del flujo de checkout invitado, 0% de integración de pago real).
Implementado: selección de función, selección de cantidad por tipo de entrada, resumen, datos del comprador (nombre/apellido/email/DNI, sin cuenta), confirmación "instantánea" (ver Mercado Pago — hoy no hay paso de pago real intermedio), recuperación de una compra en curso por `saleToken` en la URL (sobrevive a recargas de página), reintento con backoff/timeout si la confirmación tarda. Pendiente: **no existe ningún paso de pago real** — comprar hoy es funcionalmente gratis para cualquier evento, pago o no, del lado técnico (ver sección 7).

### Confirmación / Mercado Pago
**Objetivo:** cobrar de verdad y confirmar la venta según el resultado del pago. **Estado: NO implementado.** **~0-5%** (sólo el enum y el punto de extensión están preparados).
Implementado: nada de integración real. Existe el valor `MERCADO_PAGO` en el enum `PaymentMethod` (nunca usado en la práctica, todas las ventas se crean con `MANUAL`), un campo `Sale.confirmedBy` nullable (documentado como preparado para que una confirmación automática por webhook no tenga un organizador asociado), y un único punto de extensión aislado en el frontend (`processPayment()` en `lib/payment/paymentGateway.js`) documentado explícitamente como "la única función que va a cambiar el día que se integre Mercado Pago". Hoy esa función crea la venta y la confirma en el mismo paso, sin pasarela ni redirección a ningún checkout externo. Confirmación manual por organizador (`POST /api/sales/:id/confirm`) sí existe y es el único mecanismo real de confirmación (pensado para pagos en efectivo/transferencia cargados a mano). Pendiente: **todo** — SDK, Checkout Pro o Checkout API, webhook de notificación, conciliación de estados, manejo de pagos rechazados/pendientes, onboarding de cuenta de cobro del organizador (la pantalla de Configuración ya tiene el placeholder visual para esto, sin ninguna lógica detrás).

### Recuperación de entradas
**Objetivo:** que alguien que compró sin cuenta pueda volver a ver/descargar sus entradas. **Estado: completo.** **~95%.**
Implementado: búsqueda por email+DNI (sin revelar si existe o no una compra), código de verificación de 6 dígitos por email como segundo factor (con hash, expiración, límite de intentos, cooldown de reenvío y rate limit por IP), pantalla intermedia "Compra encontrada" antes de exponer cualquier dato, reenvío del email de confirmación completo, descarga del PDF completo de la compra, reutilización total del flujo de compra existente (`PurchaseWizard`/`SuccessStep`) vía `saleToken` para "Ver mis entradas". Pendiente: nada identificado como incompleto dentro de su alcance.

### Correos
**Objetivo:** todas las notificaciones transaccionales por email. **Estado: completo para lo que existe, acotado en alcance.** **~85%** (de lo que el proyecto necesita hoy; ver pendientes).
Implementado: 3 emails reales (confirmación de compra con QRs adjuntos + PDF, código de verificación de Scanner, código de verificación de recuperación de compra) — detalle completo en sección 8. Pendiente: no hay email de bienvenida, no hay email de aprobación/rechazo de organización (el organizador sólo se entera si vuelve a mirar el panel), no hay notificación al organizador cuando se registra una venta nueva.

### Entradas (administración)
**Objetivo:** que el organizador pueda administrar entradas ya vendidas (cancelar, rehabilitar, marcar usada, eliminar, ver historial). **Estado: completo, backend y frontend.** **~90%.**
Implementado: modelo de datos con auditoría completa (`TicketAuditLog`, append-only) y check-ins históricos (`CheckIn`, ya no 1:1 con la entrada — una entrada reactivada puede volver a tener ingresos), 5 operaciones administrativas individuales (cancelar/rehabilitar/reactivar/marcar usada manualmente/eliminar con soft delete) cada una con su fila de auditoría, acciones masivas sobre selección múltiple (cancelar/rehabilitar/eliminar), pantalla del organizador con selector de evento/función, buscador server-side (número/nombre/email/DNI), tarjetas de resumen por estado, selección múltiple con checkbox, drawer lateral de detalle con check-ins y auditoría completos. Pendiente: la acción masiva "Exportar seleccionadas" está presente en la UI pero es un stub (muestra un toast "se preparará en una próxima iteración", no genera ningún archivo); los filtros por estado individuales (pills "Disponibles/Utilizadas/Canceladas/Reintegradas/Eliminadas") quedaron sin punto de entrada en la UI actual — el estado que los controla (`statusFilter`) sigue existiendo y viajando al backend, pero no hay ningún control visible que lo cambie (ver sección 14, deuda técnica).

### Scanners
**Objetivo:** operar el control de acceso en la puerta de un evento, sin necesidad de una cuenta de usuario tradicional. **Estado: completo.** **~95%.**
Implementado: alta de invitaciones por el organizador (una o varias, por puerta), registro público único por invitación (nombre/apellido/DNI/email/teléfono + código de 6 dígitos), portal de acceso recurrente "Soy Scanner" (email + código de 6 dígitos, sin contraseña, sin Clerk) para todo ingreso posterior a la invitación, sesión propia por JWT firmado (24hs), verificación de que el scanner sigue `ACTIVE` en cada request (una desactivación del organizador corta el acceso al instante), dashboard previo (identidad, evento, puerta, estado, último acceso, entradas validadas hoy), selección de evento/función, lector de QR con cámara, historial de escaneos, estadísticas de función, validación con garantías de concurrencia verificadas (ver sección 7). Pendiente: el rol `SCANNER` de `User`/Clerk no se usa en este flujo (es intencional, no una carencia); no hay una vista de "todas las puertas en vivo" para el organizador durante el evento (sólo historial/estadísticas por función).

### Dashboard Organizador
**Objetivo:** panorama general del organizador. **Estado: completo, con datos reales de punta a punta.** **~90%.**
Implementado: banner de estado de la organización (pendiente/rechazada/suspendida/aprobada); selector de evento destacado (en curso/próximo/finalizado) que alimenta todo lo demás de la pantalla; hero del evento seleccionado con ocupación real; resumen del evento en 4 bloques — **Comercial** (recaudación, entradas vendidas, ticket promedio — sólo `origin=SALE`, nunca incluye cortesías), **Emisión** (entradas emitidas totales + desglose por canal con nombres amigables, ej. "💰 Vendidas" / "🎁 Cortesías"), **Accesos** (ingresadas, pendientes de ingreso, canceladas si aplica) y **Ocupación** (capacidad, emitidas, disponibles, % de ocupación) — todos calculados 100% en el backend (`functionCapacity.service.js`), nunca recalculados en el cliente; actividad reciente del evento (ventas, check-ins, acciones de auditoría, altas de scanner) combinada en una sola línea de tiempo; grilla "Estado de mis eventos" (todos los eventos de la organización) con capacidad/ocupación reales vía un endpoint batcheado propio (`GET /api/events/mine/stats`); tabla de últimas ventas del evento seleccionado. "Capacidad total"/"Entradas emitidas" del bloque Ocupación suman todas las funciones vigentes del evento a propósito (capacidad real de toda la temporada, no de una función suelta) — verificado correcto en una auditoría de código punta a punta. Pendiente: la "recaudación" que se muestra es la suma de ventas ya `CONFIRMED` en la base — sigue sin existir un cobro real (ver Mercado Pago).

### Dashboard Developer
**Objetivo:** panorama general de la plataforma para el equipo de PaseCultural. **Estado: maqueta visual, sin ningún dato real.** **~10%** (sólo el layout/diseño).
Implementado: layout completo con tarjetas de estadísticas, gráfico de ventas de 7 días, gráfico de dona de estado de entradas, lista de próximos eventos, actividad reciente. Pendiente: **absolutamente todo el contenido es un valor hardcodeado en el código** (usuarios, eventos, entradas vendidas, ventas, la serie del gráfico, los eventos "próximos" con fechas de 2025, la actividad reciente) — no hay ninguna llamada a la API en todo el archivo. Los botones "Ver todos"/"Ver todas" no tienen acción.

### Dashboard Scanner
**Objetivo:** pantalla previa al lector de QR para el operador de puerta. **Estado: completo.** **~95%.** (Ya cubierto en el módulo "Scanners" — se lista aparte porque el pedido lo pide como ítem propio.)

### Configuración
**Objetivo:** que el organizador administre los datos de su organización. **Estado: completo salvo cobros.** **~70%.**
Implementado: edición de todos los datos de la organización (nombre, tipo, CUIT, contacto, ubicación, redes, logo, descripción). Pendiente: la tarjeta "Datos bancarios / Mercado Pago" es un placeholder estático ("Próximamente"), sin ningún campo ni lógica — coincide con que Mercado Pago no está integrado.

### Mercado Pago
Ver arriba ("Confirmación / Mercado Pago") — se repite acá porque el pedido lo pide como módulo propio. **Estado: no implementado. ~0-5%.**

### Medios (Cloudinary)
**Objetivo:** subir y administrar imágenes (portadas de evento, logos de organización). **Estado: completo.** **~95%.**
Implementado: subida genérica de imágenes (5MB máx, PNG/JPEG/WEBP), borrado por `publicId`, usado tanto para portadas de evento como logos de organización. Sin pendientes identificados dentro de su alcance.

---

## 3. FRONTEND

Todas las pantallas, agrupadas por área. Para cada una: ruta, propósito, estado, componentes principales.

### Públicas (sin autenticación, dentro de `PublicShell`)

| Ruta | Propósito | Estado | Componentes principales |
|---|---|---|---|
| `/` | Home / marketplace | Terminada | `HeroCarousel`, `CategoryFilterBar`, `EventsCarousel` (x3), `TrustBar`, `RecoverPurchaseSection`, `ScannerPortalSection` |
| `/eventos` | Listado con filtros/búsqueda/orden | Terminada | `EventCard`, filtros por querystring |
| `/evento/:slug` | Detalle público de evento | Terminada | `MediaEmbed`, `SocialLinks`, `LocationMap` |
| `/comprar` | Wizard de compra (nuevo o recuperado por `saleToken`) | Terminada como checkout; sin pago real | `PurchaseWizard` + 5 steps, `PurchaseOverlay` |
| `/mis-entradas` | Entradas del usuario con cuenta | Terminada | `TicketCard`, `TicketDetailModal`, `TicketQrModal`/`TicketQrFullscreen` |
| `/recuperar-compra` | Recuperación de compra sin cuenta | Terminada | flujo propio de código de 6 dígitos, pantalla "Compra encontrada" |
| `/scanner/invitacion/:token` | Registro único de scanner por invitación | Terminada | `ScannerInvitationClaim` |
| `/scanner/portal` | Login recurrente de scanner (email+código) | Terminada | `ScannerPortal` |
| `/para-organizadores` | Landing comercial | Terminada (contenido estático) | `Hero`/`Features`/`HowItWorks`/`CtaBanner`/`TrustBar` propios de la landing |
| `/como-funciona` | Explicación + FAQ | Terminada (contenido estático) | `FaqAccordion`, `SecurityCard`, `StepCard` |
| `/perfil` | Perfil del usuario | **Stub** (`ComingSoon`) | — |
| `/iniciar-sesion` | Login | Terminada (componente prebuilt de Clerk) | `<SignIn/>` de Clerk |
| `/registro` | Registro | Terminada (componente prebuilt de Clerk) | `<SignUp/>` de Clerk |

### Scanner (shell propio, sin Clerk)

| Ruta | Propósito | Estado |
|---|---|---|
| `/scanner` | Toda la app de Scanner (dashboard → selección → lector) | Terminada |

### Auth-gated fuera del panel

| Ruta | Propósito | Estado |
|---|---|---|
| `/bienvenida` | Redirección post-login según rol | Terminada |
| `/organizador/nueva-organizacion` | Alta de organización | Terminada |

### Panel Developer (`RoleGuard["developer"]`)

| Ruta | Propósito | Estado |
|---|---|---|
| `/developer` | Dashboard general | **Maqueta, sin datos reales** |
| `/developer/organizaciones` | Aprobar/rechazar/suspender organizaciones | Terminada |
| `/developer/usuarios` | Gestión de usuarios (rol, estado, baja) | Terminada |

### Panel Organizador (`RoleGuard["organizer"]`, bajo `/organizador`)

| Ruta | Propósito | Estado |
|---|---|---|
| `/organizador` | Dashboard | Terminada, con datos reales (ver §9) |
| `/organizador/eventos` | Listado/CRUD de eventos | Terminada |
| `/organizador/eventos/nuevo` | Creación conversacional de evento | Terminada |
| `/organizador/eventos/:id/editar` | Edición por wizard clásico | Terminada |
| `/organizador/entradas` | Administración de entradas vendidas | Terminada, con deuda técnica puntual (ver §14) |
| `/organizador/tipos-de-entrada` | Catálogo de tipos de entrada (solo lectura) | Terminada, con columna "Vendidas" siempre en 0 |
| `/organizador/cortesias` | Landing del módulo Cortesías | Terminada |
| `/organizador/cortesias/emitir` | Asistente de emisión de cortesía | Terminada |
| `/organizador/cortesias/historial` | Historial de cortesías emitidas | Terminada |
| `/organizador/ventas` | Ventas/órdenes | **Stub permanente** |
| `/organizador/scanners` | Gestión de scanners de un evento | Terminada |
| `/organizador/scanners/nuevo` | Alta conversacional de invitaciones de scanner | Terminada |
| `/organizador/configuracion` | Datos de la organización | Terminada salvo cobros (placeholder) |

Ruta comodín `*` dentro del panel → pantalla local "Página no encontrada".

---

## 4. BACKEND

**Servicios (`backend/src/services/`):** `auth.service.js`, `user.service.js`, `organization.service.js`, `event.service.js`, `functionCapacity.service.js` (única fuente de capacidad/emitidas/vendidas/ingresadas/canceladas — por función, por evento y batcheada para todos los eventos del organizador), `sale.service.js`, `courtesy.service.js` (emisión/historial/estadísticas/cancelación de cortesías, reutilizando `sale.service.js`/`ticketAdmin.service.js` en vez de duplicar lógica de venta), `saleRecoveryVerification.service.js`, `ticket.service.js`, `ticketAdmin.service.js`, `scanner.service.js`, `scannerInvitation.service.js`, `scannerLogin.service.js`, `eventScanner.service.js`, `scannerRead.service.js`, `media.service.js`, más el subárbol `email/` (`sendSaleConfirmationEmail.service.js`, `sendScannerVerificationCode.service.js`, `sendSaleRecoveryVerificationCode.service.js`, `ticketQrImages.js`, `ticketsPdf.js`, `formatDateAR.js`) y el subárbol `conversation/` (`EventCreationEngine.js`, `EventServicePort.js`, `steps/`, `inputHandlers/`, `errorMessages.js`).

**Controllers (`backend/src/controllers/`):** un archivo por dominio, espejo casi 1:1 de los services: `auth.controller.js`, `user.controller.js`, `organization.controller.js`, `event.controller.js`, `eventScanner.controller.js`, `functionCapacity.controller.js`, `sale.controller.js`, `courtesy.controller.js`, `ticket.controller.js`, `ticketAdmin.controller.js`, `scanner.controller.js`, `scannerRead.controller.js`, `scannerInvitation.controller.js`, `scannerAuth.controller.js`, `media.controller.js`. Todos siguen el mismo patrón: sólo validan `req`, llaman al service y devuelven la respuesta; la lógica de negocio vive exclusivamente en los services.

**Routes (`backend/src/routes/`):** `auth.routes.js`, `user.routes.js`, `organization.routes.js`, `media.routes.js`, `event.routes.js` (incluye las sub-rutas de scanners, capacidad/estadísticas y administración de entradas de un evento), `conversation.routes.js`, `sale.routes.js`, `courtesy.routes.js`, `ticket.routes.js`, `scanner.routes.js`, `scannerInvitation.routes.js`, `scannerAuth.routes.js`. Ver inventario completo de endpoints en la sección 10.

**Middlewares (`backend/src/middlewares/`):** exactamente 4 archivos — `requireAuth.js` (sólo confirma que hay sesión de Clerk), `requireRole.js` (variádico, resuelve y adjunta el `User` local, 401/403 según corresponda), `requireScannerSession.js` (JWT propio del módulo Scanner, revalida `ACTIVE` contra la base en cada request), `rateLimit.js` (limitador en memoria por IP, sin dependencia externa). CORS y el manejo global de errores no son middlewares propios sino configuración inline en `app.js` (`cors()`) y el módulo `errors/errorHandler.js`.

**Jobs.** No existe ningún sistema de jobs/colas/tareas programadas en el proyecto (sin cron, sin worker, sin cola de mensajes). Todo procesamiento es síncrono dentro del ciclo request/response.

**Emails.** Ver sección 8 completa.

**Utilidades (`backend/src/utils/`):** entre otras, `getUserByClerkId.js`, `validateEmail.js`, `validateBuyerDocument.js` (normalización/validación de DNI, compartida por compra, recuperación y auditoría de entradas), `validateOrganization.js`, `organizationTrust.js` (`canPublishEvents`), `generateSlug.js`, `mediaParser.js` (detección de plataforma de un link pegado), `verificationCode.js` (generación/hash/comparación de códigos de 6 dígitos, compartida entre Scanner y recuperación de compra), `withTimeout.js` (compartido por los tres servicios de email), `htmlEscape.js`, `ticketNumber.js`, `calendarDate.js` (única infraestructura del backend para fechas de calendario "YYYY-MM-DD" — parseo/normalización/combinación con hora en la timezone oficial de la plataforma, `-03:00` fijo, nunca `new Date(string)` directo; usada por todo el motor conversacional de creación de eventos).

**Configuración (`backend/src/config/`):** `prisma.js` (cliente singleton), `resend.js` (cliente Resend + config de remitente, validación perezosa), `cloudinary.js`, `qrEncryption.js` (cifrado AES-256-GCM del secreto de cada QR), `scannerSession.js` (firma/verificación del JWT propio de Scanner).

---

## 5. BASE DE DATOS

Todas las entidades del `schema.prisma` (18 modelos, 21 enums), con propósito, relaciones y uso actual.

- **User** — cuenta de cualquier persona (comprador, organizador, developer); `clerkId` nullable para soportar compra de invitado. Relaciona con `Organization` (dueño), `Sale` (comprador), `Ticket` (comprador/dueño de la entrada, roles separados a propósito para una futura transferencia de entradas). Uso: activo, es el centro de identidad de toda la app salvo el módulo Scanner.
- **Organization** — una entidad organizadora, dueña de sus eventos. Relaciona 1 a 1 con su `owner User`, 1 a N con `Event`. Uso: activo, con ciclo de aprobación por Developer.
- **Event** — un evento cultural. Relaciona con `Organization`, y 1 a N con `EventFunction`, `TicketType`, `EventLink`, `Sale`, `Ticket`, `EventScanner`. Uso: activo, es la entidad central del catálogo.
- **EventLink** — un link asociado a un evento (red social, video promocional, etc.), con metadata de embed resuelta del lado servidor. Uso: activo.
- **EventFunction** — una fecha/función concreta de un evento (nunca el precio/stock, que vive en `TicketType`). Relaciona con `FunctionTicketType`, `Sale`, `Ticket`. Uso: activo.
- **TicketType** — catálogo reusable de tipos de entrada de un evento (precio, stock, nombre). Relaciona con `FunctionTicketType`, `SaleItem`, `Ticket`. Uso: activo.
- **FunctionTicketType** — asigna un `TicketType` a una `EventFunction` concreta, con overrides opcionales de precio/stock/visibilidad. Uso: activo.
- **ConversationState** — estado persistido del motor conversacional de creación de eventos (borrador en curso, paso actual, historial de navegación). Uso: activo mientras dura la conversación; se vuelve irrelevante una vez que el evento se publica/guarda.
- **Sale** — una venta/orden de compra. Relaciona con `User` (comprador), `Event`, `EventFunction`, y 1 a N con `SaleItem`/`Ticket`. Incluye todo el seguimiento de envío del email de confirmación. Tiene `origin` (enum `SaleOrigin`: `SALE`/`COURTESY`, default `SALE`) — distingue una venta real de una cortesía sin duplicar el modelo; toda métrica comercial (recaudación, Mercado Pago cuando exista) filtra explícitamente por `origin=SALE`. Uso: activo, es la entidad central de la compra.
- **CourtesyIssuance** — metadata de una cortesía (motivo, nota libre, método de entrega, quién la emitió), 1 a 1 con la `Sale` que la representa — nunca un sistema de tickets paralelo, la cortesía usa exactamente el mismo `Sale`/`Ticket`/`TicketQr` que una venta real, sólo con `origin=COURTESY` y precio 0. Uso: activo.
- **SaleRecoveryVerification** — sesión de código de 6 dígitos para el flujo de recuperación de compra, con clave única por par email+DNI normalizado (no por venta, porque un mismo par puede matchear varias). Uso: activo, vida corta (se invalida tras usarse).
- **SaleItem** — línea de detalle de una venta (tipo de entrada + cantidad + precio congelado al momento de la compra). Uso: activo.
- **Ticket** — una entrada individual y escaneable, generada recién al confirmarse la venta. Relaciona con `Sale`, `Event`, `EventFunction`, `TicketType`, `User` (comprador y dueño), y 1 a N con `TicketQr`, `CheckIn`, `ScanAttempt`, `TicketAuditLog`. Tiene su propio `origin` (mismo enum `SaleOrigin`, copiado de `Sale.origin` al emitirse) — denormalizado a propósito porque Prisma no puede agrupar por un campo de una relación: es lo que permite que `functionCapacity.service.js` desglose emitidas/vendidas por canal (y cualquier canal futuro — STAFF/PRESS/VIP/etc. — sin tocar código, sólo agregando el valor al enum) sin un join costoso. El Scanner también lo usa para mostrar el canal de la entrada escaneada (💰 venta / 🎁 cortesía). Uso: activo, es la entidad central del control de acceso.
- **TicketQr** — el secreto del QR de una entrada, cifrado de forma reversible (nunca en texto plano, nunca como imagen persistida). Uso: activo.
- **CheckIn** — historial de ingresos de una entrada (ya no es 1 a 1 con `Ticket`: una entrada reactivada puede volver a tener check-ins). Guarda origen (escaneo real o carga manual), puerta, scanner y dispositivo. Uso: activo.
- **ScanAttempt** — auditoría de TODO intento de escaneo, válido o no (a diferencia de `CheckIn`, que sólo registra los válidos). Uso: activo, es el log completo para detectar QR reusados/compartidos.
- **TicketAuditLog** — bitácora append-only de toda acción administrativa sobre una entrada (cancelar/rehabilitar/reactivar/marcar usada/eliminar), con actor, motivo y transición de estado. Uso: activo, nunca se actualiza ni se borra por código.
- **EventScanner** — una persona/puesto de scanner para un evento puntual, sin cuenta de Clerk. Contiene tanto el ciclo de vida de la invitación como los datos de verificación por código. Uso: activo, es la identidad completa del módulo Scanner.

**Enums:** `Role`, `UserStatus`, `OrganizationStatus`, `OrganizationType`, `EventStatus`, `EventVisibility`, `FunctionStatus`, `ConversationChannel`, `ConversationStatus`, `SaleStatus`, `SaleOrigin` (`SALE`/`COURTESY` — el discriminador comercial/operativo de toda la plataforma), `PaymentMethod`, `EmailDeliveryStatus`, `TicketStatus`, `ScanResult`, `CourtesyReason` (Sponsor/Prensa/Invitado/Staff/Artista/Familiar/Protocolo/Otro), `CourtesyDeliveryMethod` (`SHARE`/`EMAIL`), `CheckInSource`, `TicketAuditAction`, `TicketAuditActorType`, `EventScannerStatus`.

---

## 6. FLUJOS IMPLEMENTADOS

**Registro organizador.** Un usuario con sesión de Clerk (cualquier rol previo) llama a crear una organización → si no tenía una, se crea en estado `PENDING` y su rol pasa de `CUSTOMER` a `ORGANIZER` automáticamente → puede operar el panel de organizador y armar eventos en borrador desde el primer momento → sólo puede **publicar** un evento una vez que un Developer aprueba la organización.

**Creación de evento.** Dos caminos posibles, ambos terminan en las mismas tablas: (a) motor conversacional paso a paso, que arma un `draftEvent` en JSON dentro de `ConversationState` y recién crea el `Event` real al confirmar "Publicar"/"Guardar borrador" en la vista previa; (b) wizard clásico de formulario, usado siempre para **editar** un evento ya existente (no para crear uno nuevo). Ambos pasan por las mismas validaciones de publicación (organización aprobada, ubicación completa, al menos una función y un tipo de entrada con precio/stock).

**Compra.** El comprador elige función y cantidades sin necesidad de cuenta → completa nombre/apellido/email/DNI → se crea la `Sale` en estado `PENDING` → se confirma en el mismo paso (hoy no hay pasarela de pago real intermedia) → al confirmar se generan los `Ticket` individuales con su `TicketQr` cifrado → se dispara el email de confirmación con los QR y el PDF adjuntos.

**Confirmación.** Hoy existen dos caminos de confirmación: automática (la que dispara el propio flujo de compra, simulando un pago instantáneo) y manual (el organizador confirma una venta cargada a mano, por ejemplo un pago en efectivo). No existe un tercer camino por webhook de pasarela de pago porque no hay pasarela integrada.

**Cortesías.** El organizador elige evento → función (se saltea si sólo hay una) → tipo de entrada del catálogo existente → cantidad → motivo opcional → método de entrega → se crea la misma `Sale`/`Ticket`/`TicketQr` que generaría una venta real, pero con `origin=COURTESY` y precio 0, reutilizando el mismo `confirmSaleService` (con la única diferencia de que "Compartir" no dispara el email automático, para no mandarlo dos veces si el organizador también decide compartir el link). Queda auditada en `CourtesyIssuance` y nunca afecta ninguna métrica comercial (recaudación, ticket promedio, etc.), que siguen filtrando exclusivamente por `origin=SALE`.

**Generación QR.** Al confirmarse la venta, cada `Ticket` recibe un `TicketQr` cuyo secreto se genera y se cifra (AES-256-GCM) antes de guardarse — nunca se persiste en texto plano ni como imagen. El QR que ve el comprador se arma al vuelo (`ticketId.secretDescifrado`) cada vez que hace falta mostrarlo (email, "Mis entradas", PDF), nunca se guarda una imagen del QR en la base.

**Correo.** Disparado automáticamente tras la confirmación de una venta (por cualquiera de los dos caminos), con reintento idempotente (nunca duplica el envío si se llama más de una vez para la misma venta) y reenvío manual disponible tanto para el comprador (por token público) como para el organizador/developer (por id interno, autenticado).

**Recuperación.** El comprador sin cuenta busca por email+DNI (respuesta siempre genérica, no revela si existe o no una coincidencia) → si hay una compra real, se envía un código de 6 dígitos al correo → verificado el código, recién ahí se revela la compra (una pantalla intermedia "Compra encontrada", nunca los datos completos antes del código) → desde ahí puede ver sus entradas (reutilizando el flujo de compra por `saleToken`), reenviar el email o descargar el PDF completo.

**Scanner.** Un organizador genera invitaciones para una puerta → la persona invitada se registra una única vez (datos personales + código de 6 dígitos) → de ahí en más, todo acceso pasa por el Portal Scanner (email + código de 6 dígitos, sin contraseña) → sesión propia por JWT → dashboard previo → selección de evento/función → lector de cámara → cada escaneo válido marca la entrada como usada de forma atómica (a prueba de dos scanners escaneando el mismo QR al mismo tiempo) y registra un `CheckIn` + un `ScanAttempt`.

**Administración de entradas.** El organizador, desde el panel, puede cancelar, rehabilitar, reactivar (una entrada ya usada), marcar como usada manualmente (sin escaneo real) o eliminar (soft delete) cualquier entrada de sus eventos, individualmente o en lote — cada acción queda auditada.

**Auditoría.** Toda acción administrativa sobre una entrada (nunca un escaneo normal, que ya tiene su propio registro en `ScanAttempt`/`CheckIn`) genera una fila en `TicketAuditLog` con quién, cuándo, desde qué estado a cuál y por qué motivo (opcional) — nunca se actualiza ni se borra una fila de esa tabla por código.

---

## 7. SEGURIDAD

**Autenticación.** Dos sistemas completamente separados y deliberadamente no unificados: (1) Clerk para cualquier persona con cuenta (comprador registrado, organizador, developer) — el backend nunca valida contraseñas ni sesiones por su cuenta, delega 100% en el SDK de Clerk; (2) un sistema propio, sin Clerk, para el módulo Scanner — JWT firmado por el propio backend (`SCANNER_SESSION_SECRET`, 24hs de vigencia), emitido sólo tras verificar un código de 6 dígitos.

**Autorización.** Basada en rol (`Role` de `User`, resuelto siempre server-side vía `requireRole`, nunca confiado desde el cliente) para todo lo que no es del módulo Scanner. Dentro del panel de organizador, además del rol, cada acción revalida que el recurso (evento, scanner, entrada) pertenezca a la organización del que hace el pedido — nunca alcanza con tener rol `ORGANIZER`, tiene que ser dueño del recurso puntual.

**Permisos.** El rol `DEVELOPER` es el único que puede aprobar/rechazar organizaciones, cambiar el rol o estado de cualquier usuario, o listar todo el sistema sin acotarse a una organización propia. El rol `ORGANIZER` está siempre acotado a los eventos de su propia organización.

**Tokens.** Tres tipos de token público distintos, cada uno con un propósito único y sin superposición: `Sale.publicRecoveryToken` (autoriza confirmar/consultar/recuperar una venta puntual sin cuenta), `EventScanner.invitationToken` (autoriza el registro único de un scanner — después de la activación, ya no sirve para volver a entrar, sólo dentro de una ventana de gracia de 2 minutos pensada exclusivamente para un doble-envío accidental del mismo formulario), y el JWT de sesión de Scanner (autoriza operar el lector, revalidado contra la base en cada request).

**QR.** El secreto de cada entrada se genera con un generador criptográfico seguro, se cifra de forma reversible antes de guardarse (la clave vive fuera de la base, en una variable de entorno) y nunca se persiste en texto plano ni como imagen. La validación de un escaneo compara el secreto provisto contra el descifrado en tiempo constante (protección contra timing attacks).

**Protección contra reutilización.** Verificada explícitamente con pruebas de concurrencia real (múltiples escaneos simultáneos del mismo QR, incluyendo hasta 20 en paralelo sobre la misma entrada): la garantía real es un `UPDATE` condicional atómico sobre el estado de la entrada dentro de una transacción — nunca puede haber dos escaneos válidos para la misma entrada, sin importar cuántos scanners la escaneen al mismo tiempo ni la velocidad del servidor.

**Rate limits.** Limitador propio en memoria (sin dependencia externa, no apto para múltiples instancias del servidor sin adaptarlo) aplicado a los endpoints públicos "adivinables": búsqueda de recuperación de compra, reenvío de código de recuperación, verificación de código de recuperación, registro/reenvío/verificación de invitación de scanner, login/reenvío/verificación del Portal Scanner.

**Recuperación.** Ver flujo completo en la sección 6 — diseñada explícitamente para no revelar nunca si un email/DNI existen en el sistema antes de verificar el código.

---

## 8. CORREOS

Tres emails implementados, los tres vía Resend:

1. **Confirmación de compra** — se dispara automáticamente al confirmarse una venta (por cualquiera de los dos caminos de confirmación) y también puede reenviarse manualmente (por el comprador vía token público, o por organizador/developer vía id interno). Contiene: los QR de cada entrada embebidos como imagen y un PDF adjunto con todas las entradas de la venta. Envío protegido contra duplicados con un reclamo atómico (nunca se manda dos veces para el mismo intento simultáneo).
2. **Código de verificación de Scanner** — se dispara tanto en el registro único por invitación como en cada login por el Portal Scanner. Contiene el código de 6 dígitos, vigente 10 minutos.
3. **Código de verificación de recuperación de compra** — se dispara al buscar una compra por email+DNI (sólo si hay una coincidencia real, aunque la respuesta al usuario sea siempre la misma exista o no). Contiene el código de 6 dígitos, vigente 10 minutos, sin mencionar ningún dato de la compra.

**Qué falta.** No hay email de bienvenida al crear una cuenta, no hay notificación al organizador cuando su organización es aprobada/rechazada (tiene que volver a mirar el panel), no hay notificación de venta nueva al organizador. Los emails transaccionales propios de Clerk (verificación de cuenta, magic link, etc.) los maneja Clerk por su cuenta, fuera de este código.

---

## 9. DASHBOARDS

**Developer.** Muestra tarjetas de estadísticas generales, un gráfico de ventas de 7 días, un gráfico de dona de estado de entradas, próximos eventos y actividad reciente — **absolutamente todo con datos hardcodeados en el código**, sin ninguna llamada a la API. Falta: conectar cada sección a datos reales (no existe siquiera el intento de fetch).

**Organizador.** Banner de estado de la organización, selector de evento destacado, hero con ocupación real, resumen del evento en 4 bloques (Comercial/Emisión/Accesos/Ocupación — todos calculados en el backend, única fuente de verdad compartida con la pantalla de Entradas), actividad reciente, grilla "Estado de mis eventos" y últimas ventas — todo con datos reales, incluida la capacidad total sumada correctamente a través de todas las funciones vigentes del evento. Falta: la "recaudación" mostrada es la suma de ventas confirmadas en la base, no un cobro real (ligado a Mercado Pago).

**Scanner.** Completo — identidad del scanner, evento, puerta, estado, último acceso y entradas validadas hoy, todo con datos reales resueltos del lado servidor. Sin pendientes identificados.

---

## 10. APIs

### Endpoints públicos (sin autenticación)
- `GET /api/health`
- `GET /api/events/public`, `GET /api/events/public/:slug`, `GET /api/events/categories`
- `POST /api/sales`, `POST /api/sales/:token/confirm-by-buyer`, `GET /api/sales/:token/status`, `GET /api/sales/:token/pdf`, `POST /api/sales/:token/resend-email`
- `POST /api/sales/recover`, `POST /api/sales/recover/resend`, `POST /api/sales/recover/verify`
- `GET /api/scanner-invitations/:token`, `POST /api/scanner-invitations/:token/register`, `POST /api/scanner-invitations/:token/resend`, `POST /api/scanner-invitations/:token/verify`
- `POST /api/scanner-auth/request-code`, `POST /api/scanner-auth/resend-code`, `POST /api/scanner-auth/verify`

### Endpoints privados (requieren sesión de Clerk, o sesión propia de Scanner)

**Auth:** `POST /api/auth/sync`.

**Usuarios (sólo Developer):** `GET /api/users`, `GET /api/users/count`, `GET /api/users/:id`, `PATCH /api/users/:id/role`, `PATCH /api/users/:id/status`, `DELETE /api/users/:id`.

**Organizaciones:** `GET /api/organizations/me`, `PATCH /api/organizations/me`, `DELETE /api/organizations/me`, `POST /api/organizations` (cualquier usuario con sesión); `GET /api/organizations`, `GET /api/organizations/:id`, `PATCH /api/organizations/:id/status`, `DELETE /api/organizations/:id` (sólo Developer).

**Eventos:** `GET /api/events/scanner-events`, `POST /api/events`, `GET /api/events/mine`, `GET /api/events/mine/stats` (capacidad/emitidas/vendidas/ingresadas de todos los eventos vigentes del organizador en una sola tanda de consultas, fuente de la grilla "Estado de mis eventos" del Dashboard), `GET /api/events/:id`, `PATCH /api/events/:id`, `PUT /api/events/:id/schedule`, `PUT /api/events/:id/links`, `GET /api/events/:id/functions/stats` (mismo cálculo, por función, para un evento puntual), `DELETE /api/events/:id`.

**Scanners de un evento (dentro de `/api/events`):** `GET /:id/scanners`, `POST /:id/scanners`, `PATCH /:id/scanners/:scannerId`, `POST /:id/scanners/:scannerId/disable`, `POST /:id/scanners/:scannerId/reactivate`, `POST /:id/scanners/:scannerId/revoke`, `POST /:id/scanners/:scannerId/regenerate`, `DELETE /:id/scanners/:scannerId`.

**Administración de entradas de un evento (dentro de `/api/events`):** `POST /:id/tickets/bulk-action`, `POST /:id/tickets/:ticketId/cancel`, `POST /:id/tickets/:ticketId/rehabilitate`, `POST /:id/tickets/:ticketId/reactivate`, `POST /:id/tickets/:ticketId/mark-used`, `DELETE /:id/tickets/:ticketId`.

**Conversación (creación de eventos por chat):** `POST /api/conversations/start`, `GET /api/conversations/:id/status`, `GET /api/conversations/:id`, `POST /api/conversations/:id/reply`, `DELETE /api/conversations/:id`.

**Ventas:** `GET /api/sales/mine`, `GET /api/sales` (sólo Organizer), `POST /api/sales/:id/confirm` (sólo Organizer), `POST /api/sales/:id/cancel`, `POST /api/sales/:id/resend-confirmation-email` (Developer u Organizer).

**Cortesías (sólo Organizer/Developer):** `POST /api/courtesies` (emitir), `GET /api/courtesies` (historial con filtros), `GET /api/courtesies/stats`, `POST /api/courtesies/:saleId/resend-email`, `GET /api/courtesies/:saleId/pdf`, `POST /api/courtesies/:saleId/cancel`.

**Entradas (comprador):** `GET /api/tickets/mine`, `GET /api/tickets/number/:ticketNumber`, `GET /api/tickets/:id/qr`, `GET /api/tickets/:id`.

**Entradas (organizador, listado global):** `GET /api/tickets/organizer`.

**Medios:** `POST /api/media/upload`, `DELETE /api/media/*publicId`.

**Módulo Scanner (sesión propia, no Clerk):** `GET /api/scanner/dashboard`, `GET /api/scanner/events`, `GET /api/scanner/events/:eventId/functions/:functionId/stats`, `GET /api/scanner/scan-attempts`, `POST /api/scanner/validate`.

---

## 11. FUNCIONALIDADES TERMINADAS

- Autenticación de usuarios con cuenta vía Clerk, con sincronización a base propia.
- Alta, edición, aprobación y suspensión de organizaciones.
- Creación y edición de eventos por dos caminos (chat y wizard), con reglas de publicación.
- Catálogo de tipos de entrada con overrides por función.
- Checkout de compra sin cuenta, de punta a punta (sin pago real).
- Generación de entradas individuales con QR cifrado.
- Envío de email de confirmación con QR y PDF adjuntos, con reenvío.
- Recuperación de compra sin cuenta, con segundo factor por código.
- Registro único de scanner por invitación + acceso recurrente por Portal Scanner.
- Validación de QR en puerta, con garantía de consistencia bajo concurrencia real verificada con pruebas.
- Administración completa de entradas (cancelar/rehabilitar/reactivar/marcar usada/eliminar, individual y masivo) con auditoría completa.
- Panel de Developer para gestión de organizaciones y usuarios.
- Subida de imágenes (Cloudinary).
- Módulo de Cortesías (emisión, historial, estadísticas, cancelación), reutilizando de punta a punta el mismo flujo de venta/ticket/QR/email/PDF que una venta real.
- Dashboard del organizador con estadísticas reales — Comercial/Emisión/Accesos/Ocupación, una única fuente de verdad backend (`functionCapacity.service.js`) compartida entre el Dashboard y la pantalla de Entradas, con capacidad/vendidas/emitidas/ingresadas/canceladas y desglose por canal de emisión (venta/cortesía, preparado para futuros canales sin rediseño).

## 12. FUNCIONALIDADES PARCIALES

- **Pantalla "Tipos de entrada"**: todo real salvo la columna "Vendidas", hardcodeada en 0.
- **Administración de entradas (pantalla)**: las acciones individuales y masivas funcionan de punta a punta; la acción masiva "Exportar" es un botón que sólo muestra un aviso, sin generar ningún archivo; los filtros por estado individuales quedaron sin control visible en la pantalla actual (el estado y la llamada al backend siguen existiendo, pero no hay ningún botón/pill que lo dispare).
- **Compra**: el checkout completo funciona, pero "confirmar" no pasa por ningún pago real — es una confirmación automática simulada.
- **Cortesías**: un `DEVELOPER` no puede cancelar una cortesía de una organización que no administra (limitación heredada y deliberada, no ampliada); el historial no tiene todavía un filtro visible por canal de emisión (la estructura de datos ya lo permite sin cambios de arquitectura).

## 13. FUNCIONALIDADES PENDIENTES (por prioridad real, según lo que el código ya deja ver)

1. **Integración de Mercado Pago** — es la ausencia más grande del proyecto: sin esto, ninguna venta cobra dinero de verdad. Todo el resto del sistema (entradas, QR, scanner, emails, recuperación) ya está construido asumiendo que este paso va a existir.
2. **Conectar el Dashboard de Developer a datos reales** — hoy es 100% maqueta.
3. **Exportación real de entradas seleccionadas** (el botón ya existe en la UI, sólo falta la lógica).
4. **Reponer un control visible de filtro por estado** en la pantalla de administración de entradas (el backend y el estado ya lo soportan).
5. **Onboarding de datos de cobro del organizador** (ligado directamente a Mercado Pago).
6. **Notificaciones por email adicionales** (aprobación/rechazo de organización, venta nueva).
7. **Adaptador de WhatsApp** para el motor conversacional de creación de eventos (el modelo de datos ya lo contempla).
8. **Páginas legales reales** (Términos y Privacidad hoy enlazan a la home).
9. **Pantalla de perfil del usuario** (hoy es un stub).
10. **Filtro visible por canal de emisión** en el historial de Cortesías (dato ya disponible, falta sólo la UI).

## 14. DEUDA TÉCNICA

**Problemas conocidos / hallazgos concretos de código:**
- En la pantalla de administración de entradas del organizador, el estado `statusFilter` y su lógica de filtrado siguen presentes y viajan al backend, pero no hay ningún control en la interfaz que permita cambiarlo — quedó código vivo sin punto de entrada visible tras una evolución posterior de la pantalla (que agregó selector de evento/función y acciones masivas).
- La acción masiva "Exportar seleccionadas" está en la interfaz pero no hace nada real (sólo un aviso).
- El campo "Vendidas" de la pantalla "Tipos de entrada" es un valor fijo, no calculado.
- El Dashboard de Developer no tiene ninguna conexión a la API — es enteramente una maqueta visual con datos de ejemplo.
- **[Resuelto]** El Dashboard del organizador y la pantalla de Entradas tenían cálculos de capacidad/vendidas/ocupación duplicados e independientes entre frontend y backend (y uno de ellos no distinguía cortesías de ventas reales, inflando "Entradas vendidas"). Se consolidaron en una única fuente backend (`functionCapacity.service.js`) consumida por ambas pantallas — el `OrganizerDataContext` ya no expone una lista completa de tickets del organizador para tallar a mano en el cliente, expone el resumen ya agregado (`eventsStats`, vía `GET /api/events/mine/stats`).
- **[Resuelto]** Las fechas de calendario (sin hora) del wizard/chat de creación de eventos podían desincronizarse un día del real en timezones detrás de UTC (Argentina incluida) — `new Date("YYYY-MM-DD")` se interpreta como medianoche UTC, no local. Afectaba al selector de fecha del wizard, a la tarjeta de revisión final del evento y, más seriamente, a la hora real guardada para eventos creados por el chat (dependía de la timezone del servidor, no de Argentina). Corregido con una única infraestructura de fechas de calendario (`lib/dateGrid.js` en el frontend, `utils/calendarDate.js` en el backend) y un offset explícito `-03:00` para toda combinación fecha+hora.

**Limitaciones conocidas (documentadas en el propio código, no ocultas):**
- El rate limiter es en memoria: no sobrevive un reinicio del proceso ni se comparte entre instancias si el backend llegara a correr en más de un proceso.
- Varios campos de "quién hizo esto" (el scanner de un check-in, el actor de una auditoría) se guardan como texto suelto, sin relación formal en la base de datos — funcionan bien hoy, pero no tienen integridad referencial a nivel de base.
- El canal WhatsApp del motor conversacional está modelado en la base pero no tiene ningún adaptador real.
- La timezone oficial de la plataforma (`-03:00`, Argentina) está hardcodeada como constante en dos lugares independientes (frontend y backend, son dos proyectos npm separados sin paquete común) — correcto mientras la plataforma opere sólo en Argentina; el día que soporte más de una timezone, ambos puntos hay que tocarlos.

**Código duplicado identificado:** normalización de email/DNI y los pequeños formateadores de fecha (los que trabajan con timestamps reales, no con fechas de calendario — ver arriba) están repetidos en varios archivos del frontend en lugar de centralizados en un único lugar (patrón usado deliberadamente en este proyecto para no crear una dependencia cruzada entre pantallas que evolucionan por separado — no necesariamente un problema a resolver, pero es duplicación real si se lo mide así). Del lado del backend, la lógica de "cuál es la organización de este usuario" (`findFirst` por `ownerId`) está repetida como una función local pequeña en más de un archivo de servicio en lugar de una única función compartida.

**Módulos candidatos a mejora:** el Dashboard de Developer (reconstruir sobre datos reales), la pantalla de administración de entradas (terminar exportación y reponer el filtro por estado).

## 15. PRÓXIMOS PASOS (orden de prioridad real, según el estado actual del código, sin inventar funcionalidades)

1. Integrar Mercado Pago (SDK, checkout, webhook, conciliación de estados) — es el único paso que falta para que el dinero se mueva de verdad.
2. Terminar la exportación de entradas seleccionadas.
3. Reponer el control de filtro por estado en la pantalla de administración de entradas.
4. Conectar el Dashboard de Developer a datos reales.
5. Calcular "Vendidas" de verdad en la pantalla de Tipos de entrada.
6. Emails adicionales (aprobación de organización, venta nueva).
7. Páginas legales reales y pantalla de perfil.
8. Adaptador de WhatsApp para el motor conversacional (si el negocio lo sigue necesitando).
9. Filtro visible por canal de emisión en el historial de Cortesías.

## 16. EVALUACIÓN GENERAL

**Avance aproximado del proyecto: ~75-80%.** El core funcional completo (catálogo de eventos, checkout, entradas con QR cifrado, control de acceso con garantías de concurrencia verificadas, recuperación de compra, administración de entradas con auditoría, cortesías, estadísticas reales del organizador, paneles de Developer y Organizador para todo lo que no es venta) está implementado y, en la enorme mayoría de los casos, terminado de punta a punta backend+frontend. El hueco más grande, con diferencia, sigue siendo el cobro real.

**Para una versión Beta** (uso real con usuarios externos pero controlado): falta, como mínimo, integrar Mercado Pago (sin esto no hay negocio real posible salvo ventas 100% manuales/gratuitas). El Dashboard del organizador ya no es un bloqueante — un organizador puede ver recaudación, ocupación y accesos reales desde el panel. El resto del sistema ya está en condiciones de sostener una Beta acotada con pagos manuales/en efectivo mientras se construye la integración de pago.

**Para una versión Comercial**: además de lo anterior, se necesita el Dashboard de Developer conectado a datos reales (hoy no sirve para operar el negocio), la exportación de entradas terminada, notificaciones por email adicionales (aprobación de organización, venta nueva), páginas legales reales, y revisar/formalizar las relaciones de datos que hoy son texto suelto (scanner que hizo un check-in, actor de una auditoría) si el volumen de uso lo justifica.
