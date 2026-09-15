# Smarticket

## Qué es Smarticket

Plataforma de creación, publicación, venta y gestión de entradas/eventos:
organizadores crean eventos con funciones y tipos de entrada, venden
tickets (compra web y cortesías), y controlan el ingreso al evento con un
scanner de QR. Incluye un panel administrativo interno ("Developer") y un
motor conversacional que replica parte del flujo de creación de eventos
por WhatsApp.

El proyecto viene de una marca anterior llamada **PaseCultural** — el
código, comentarios internos, algunos identificadores técnicos (carpeta de
Cloudinary, claves de `localStorage`) y las migraciones históricas de
Prisma todavía usan ese nombre en piezas no visibles al usuario final. El
branding visible en la interfaz y en los emails ya es Smarticket.

## Arquitectura

**Frontend:** React 19 + Vite, desplegado en Vercel (`frontend/vercel.json`
sólo define el rewrite de SPA).

**Backend:** Node.js + Express 5, desplegado en Fly.io — app
`smarticket-backend-gru-test`, región `gru`/São Paulo
(`backend/fly.toml`). El nombre de la app conserva el sufijo `-test` por
motivos históricos (nació como instancia de prueba en paralelo a un
backend anterior en Render), pero es el backend real en uso hoy. Su
deploy es **manual** vía `flyctl deploy`, no automático por push — ver
sección Deploy. El código todavía contiene referencias históricas a
Render (comentarios, y la variable `process.env.RENDER_GIT_COMMIT` que
ese proveedor inyectaba) por la infraestructura anterior; no reflejan el
estado actual.

**Base de datos:** PostgreSQL (Supabase) vía Prisma.

**Auth:** Clerk (`@clerk/express` en backend, `@clerk/clerk-react` en
frontend).

**Pagos:** Mercado Pago (OAuth de marketplace + checkout + webhooks).

**Emails:** Resend.

**Media:** Cloudinary.

**WhatsApp:** Meta WhatsApp Cloud API (webhook + motor conversacional
propio en `backend/src/conversation`).

Todo lo anterior está confirmado leyendo el código real (rutas, config,
`package.json`), no es una descripción aspiracional.

## Estructura del repositorio

```
frontend/                  App React (Vite)
backend/
  src/
    routes/                Definición de endpoints Express, uno por dominio
    controllers/            Capa HTTP: parsea request, llama al service, arma response
    services/                Lógica de negocio y acceso a Prisma
    conversation/           Motor del bot de WhatsApp (estado de conversación, pasos)
    config/                  Clientes/config de servicios externos (Cloudinary, Resend, Prisma, firmas de webhook...)
    middlewares/, middleware/   Auth, rate limiting, validaciones transversales
    errors/                  Catálogo centralizado de errores de la app
  prisma/                   schema.prisma + migrations/ (historial de la base)
  tests/                    Suite de tests (node:test)
```

## Requisitos locales

Node.js — el proyecto **no declara** una versión mínima en `package.json`
(sin campo `engines`). No asumas una versión específica; usá una LTS
reciente.

## Instalación

El repo **no tiene** `package.json` en la raíz — instalá backend y
frontend por separado, nunca desde la raíz:

```
cd backend
npm install

cd ../frontend
npm install
```

## Desarrollo local

Comandos reales, tal como están definidos en cada `package.json`:

**Backend** (`backend/package.json`):
```
npm run dev       # nodemon src/server.js
npm start         # node src/server.js
npm test          # suite completa (node:test), carga backend/.env.test
npm run test:unit # sólo tests que no requieren DB real
npm run test:db   # sólo los tests que sí usan Prisma real, contra la DB de TEST
```

**Frontend** (`frontend/package.json`):
```
npm run dev       # Vite dev server
npm run build     # build de producción (lo que Vercel despliega)
npm run preview   # sirve el build localmente
```

## Variables de entorno

Ver:
- `backend/.env.example` → copiar a `backend/.env`
- `backend/.env.test.example` → copiar a `backend/.env.test` (**sólo** para
  `npm test`/`npm run test:db`, debe apuntar al proyecto Supabase de TEST,
  nunca a producción)
- `frontend/.env.example` → copiar a `frontend/.env`

Ninguno de estos ejemplos contiene valores reales.

## Base de datos / Prisma

`backend/prisma/schema.prisma` define el modelo de datos completo (eventos,
funciones, tipos de entrada, ventas, tickets, organizaciones, planes,
WhatsApp, Mercado Pago, scanners, alertas internas...).
`backend/prisma/migrations/` contiene el historial real ya aplicado en
producción.

**No edites ni borres migraciones ya aplicadas.** Son historia inmutable:
representan el estado real de la base en producción en el momento en que
se generaron. Un cambio de schema siempre se expresa como una migración
nueva.

## Deploy

Lo único confirmado por el repositorio/configuración actual:

- **Frontend →** Vercel (integración Git estándar; `frontend/vercel.json`
  sólo define el rewrite de SPA).
- **Backend →** Fly.io, app `smarticket-backend-gru-test`,
  `primary_region = gru` (`backend/fly.toml`). Deploy **manual** vía
  `flyctl deploy --app smarticket-backend-gru-test`, no automático por
  push. `backend/fly.toml` fija además que esta imagen **nunca** corre
  `prisma migrate deploy` ni ningún seed: sólo `prisma generate` + arranca
  el servidor. El schema/las migraciones se gestionan exclusivamente
  contra el proyecto Supabase configurado vía `DATABASE_URL`/`DIRECT_URL`.

No asumas que un push a `main` despliega automáticamente el backend a Fly
— nada en el repo lo demuestra; hoy requiere correr `flyctl deploy` a mano.

El backend corrió anteriormente en Render; esa infraestructura quedó
reemplazada por Fly, aunque el código conserve referencias históricas
(comentarios, `process.env.RENDER_GIT_COMMIT`) que no afectan el
comportamiento en runtime.

## Componentes críticos

- **Eventos / funciones / tipos de entrada** — catálogo publicable por el
  organizador.
- **Ventas / tickets** — compra real (Mercado Pago) y emisión manual
  (cortesías), con su propio control de stock.
- **Scanner** — valida QR de tickets en la puerta del evento.
- **Mercado Pago** — OAuth de marketplace + checkout + webhooks de
  confirmación de pago.
- **Organizaciones / planes** — cuentas de organizador y sus límites según
  plan contratado.
- **WhatsApp** — bot conversacional que replica (parcialmente) el flujo de
  creación de eventos vía Meta Cloud API.
- **Emails** — confirmaciones de compra, OTPs, alertas internas, vía
  Resend.

## Zonas sensibles

Estos archivos concentran lógica de negocio crítica o integraciones
externas delicadas. No están "prohibidos", pero cualquier cambio ahí debería
ir acompañado de tests de regresión — no es lógica trivial de tocar a
ciegas:

- `backend/src/services/sale.service.js` — ventas, stock y confirmación de
  pago (dinero real).
- `backend/src/services/event.service.js` — creación/edición de eventos,
  funciones y tipos de entrada (corazón del catálogo).
- `backend/src/controllers/whatsapp.controller.js` y
  `backend/src/conversation/` — webhook de Meta + motor conversacional, con
  lógica de deduplicación/concurrencia ya ajustada.
- `backend/src/services/mercadoPago*.service.js`,
  `backend/src/controllers/mercadoPagoWebhook.controller.js` — ya hubo un
  incidente real de reconciliación documentado (ver
  `HANDOFF_MERCADOPAGO_RECONCILIATION.md`).
- `backend/prisma/migrations/` — historial inmutable, nunca editar
  retroactivamente.

## Documentación existente

- [`INFORME_TECNICO.md`](./INFORME_TECNICO.md) — informe técnico detallado
  del estado del sistema (arquitectura, módulos, pendientes reales).
- [`HANDOFF_MERCADOPAGO_RECONCILIATION.md`](./HANDOFF_MERCADOPAGO_RECONCILIATION.md)
  — traspaso de una tarea puntual de reconciliación de Mercado Pago.

Ambos documentos viven hoy en la raíz del repositorio; una reorganización
en `/docs` queda pendiente para una ronda posterior.
