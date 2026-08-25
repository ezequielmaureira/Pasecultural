# Handoff — Reconciliación de pagos Mercado Pago

Documento de traspaso para continuar este trabajo desde otro entorno/sesión de Claude, sin acceso a la conversación original. Generado: 2026-08-24, rama `wip/mercadopago-reconciliation`.

## 1. Objetivo de esta ronda

Hacer que Smarticket/PaseCultural pueda **recuperar automáticamente una venta (Sale) de Mercado Pago que quedó PENDING** cuando Mercado Pago aprobó y cobró el pago pero el webhook nunca llegó a procesarlo (firma inválida, caída transitoria, credencial mal configurada, etc.) — sin nunca confiar en el frontend/redirect/parámetros del comprador, siempre re-consultando a Mercado Pago server-to-server, reutilizando exactamente las mismas validaciones económicas que ya usa el webhook (nunca una segunda implementación de esa lógica).

## 2. Causa del incidente real que motivó esto

`MERCADOPAGO_WEBHOOK_SECRET` en producción tenía el secret de **test** en vez del de **producción**. Mercado Pago cobró de verdad, pero el controller del webhook (`mercadoPagoWebhook.controller.js`) rechazó la notificación con `401 INVALID_SIGNATURE` **antes** de que llegara a `processMercadoPagoWebhookNotification` — o sea, la Sale afectada **nunca llegó ni siquiera a la etapa de resolución de conexión**: no tiene `paymentRef` ni `mercadoPagoPaymentId` seteados. Esto ya fue corregido (el secret correcto ya está en producción) y una segunda compra real posterior funcionó de punta a punta.

**Hay UNA Sale real de producción que quedó PENDING por este incidente.** No se guardó su ID en este documento a propósito (evitar filtrar datos operativos innecesarios acá) — quien retome debe pedírselo al usuario directamente antes de cualquier acción sobre ella. **Ver sección 10 — condiciones antes de tocarla.**

## 3. Arquitectura acordada (auditada y autorizada por el usuario antes de implementar)

- **Núcleo compartido extraído**: toda la validación económica/identidad (resolución de conexión OAuth correcta, consulta server-to-server `GET /v1/payments/{id}`, chequeo de `collector_id`, `external_reference` → Sale, organización, reversals, monto, moneda, llamada a `confirmSaleService`) vive en **un solo lugar**, usado tanto por el webhook como por la reconciliación. Cero lógica financiera duplicada.
- **Descubrimiento del payment** (cuando la Sale no tiene ningún `mercadoPagoPaymentId`/`paymentRef` conocido): se prueban las conexiones de Mercado Pago de la Organization (ACTIVE primero, después DISCONNECTED más reciente primero — por si la organización desconectó la cuenta que hizo el pago original) y se buscan candidatos vía:
  - `GET /merchant_orders/search?preference_id=...` (devuelve `payments[]` — TODOS los intentos de pago de esa preferencia, mecanismo nativo de Checkout Pro).
  - `GET /v1/payments/search?external_reference=...` (búsqueda oficial documentada, refuerzo/fallback).
  - Esto fue **validado contra el MCP oficial de Mercado Pago** antes de implementar (búsqueda de documentación) — confirmado que ambos endpoints son oficiales y que `merchant_order.payments[]` es el mecanismo específico de Checkout Pro para enumerar múltiples intentos de pago de una misma preferencia.
  - **Nunca se confía en estos resultados de búsqueda para la decisión financiera** — sólo se usan para proponer un `paymentId` candidato; la validación real siempre vuelve a pasar por el núcleo compartido (`GET /v1/payments/{id}` autoritativo).
  - Si aparece **más de un payment `approved`** para la misma Sale/preferencia → **NUNCA se confirma automáticamente** (ambigüedad) → se alerta para intervención manual (`ambiguous_approved_payments`).
- **Idempotencia y concurrencia**: se heredan enteras del guard atómico ya existente en `confirmSaleService` (`updateMany({where:{id,status:"PENDING"}})`) y de `mercadoPagoPaymentId @unique` en `Sale`. Reconciliación y webhook pueden correr en paralelo sobre el mismo payment sin duplicar nada — quien pierde la carrera recibe `already_confirmed`.
- **Stock expirado (caso crítico)**: `confirmSaleService` ya re-chequea capacidad real bajo advisory lock antes de confirmar. Si el pago es approved pero ya no hay stock real → `INSUFFICIENT_STOCK` → nunca se fuerza el Ticket, nunca se sobrevende → se persiste `paymentRef` y se alerta (`approved_but_no_stock`). Sin refund automático (fuera de alcance de esta ronda).
- **Reconciliación automática**: sin infraestructura de cron nueva (el proyecto no tenía ninguna) — mismo patrón ya usado para `runOrganizerEventNotificationsSweep.js`: un service + un script invocable bajo `backend/scripts/`, pensado para un futuro Render Cron Job **todavía NO configurado a propósito** (pedido explícito del usuario: primero validar manualmente, incluida la recuperación de la Sale real).
- **Reconciliación manual**: endpoint `POST /api/developer/sales/:id/reconcile-mercadopago`, exclusivo `requireRole("DEVELOPER")`. Recibe sólo el `saleId` del path — nunca acepta status/paymentId del cliente. Llama al mismo service que el sweep automático.
- **Observabilidad**: nuevo campo `Sale.confirmationSource` (enum `WEBHOOK | RECONCILIATION_AUTO | RECONCILIATION_MANUAL`), escrito dentro de la misma transacción atómica que ya confirma la venta — permite distinguir en la base cómo se confirmó cada Sale, sin tabla de auditoría nueva (se reusa el logging estructurado ya existente en todo el proyecto, que nunca loguea tokens/secretos).

## 4. Archivos nuevos

- `backend/src/services/mercadoPagoPaymentConfirmation.service.js` — núcleo compartido extraído. Exporta `confirmMercadoPagoPaymentIfEligible({ paymentId, candidateConnectionId, source })`. Es prácticamente el contenido íntegro que antes vivía inline en `mercadoPagoWebhook.service.js`, generalizado: `candidateConnectionId` reemplaza la resolución por `bodyUserId` (que ahora la resuelve el wrapper del webhook antes de llamar acá), y `source` se propaga a logs y a `confirmSaleService` como `confirmationSource`.
- `backend/src/services/mercadoPagoReconciliation.service.js` — descubrimiento + orquestación. Exporta:
  - `reconcileMercadoPagoSaleService(saleId, { source })` — reconcilia UNA Sale puntual (usado por el sweep y por el endpoint manual). Orden de resolución: 1) si ya tiene `mercadoPagoPaymentId` → re-verifica directo (replay idempotente); 2) si tiene `paymentRef` (caso INSUFFICIENT_STOCK ya detectado antes) → reintenta directo con una conexión candidata recién resuelta (**ver bug corregido en sección 7**); 3) si no, corre descubrimiento completo.
  - `findMercadoPagoReconciliationCandidateSaleIds()` — candidatas: `status=PENDING, paymentMethod=MERCADO_PAGO, mercadoPagoPaymentId=null` Y (`paymentRef != null` O `stockReservedUntil` vencido hace más de 5 min de margen).
  - `reconcilePendingMercadoPagoSalesService()` — sweep completo, llama a la anterior por cada candidata, nunca interrumpe el resto si una falla.
- `backend/scripts/reconcileMercadoPagoPendingSales.js` — entry point invocable (`node scripts/reconcileMercadoPagoPendingSales.js`), mismo patrón que `runOrganizerEventNotificationsSweep.js`. **NO conectado a ningún cron todavía.**
- `backend/tests/mercadoPagoReconciliation.service.test.js` — 18 tests `testWithDb` nuevos (ver sección 6).
- `backend/prisma/migrations/20260824120000_mercadopago_reconciliation_confirmation_source/migration.sql` — ver sección 5.

## 5. Archivos modificados

- `backend/prisma/schema.prisma` — nuevo enum `MercadoPagoConfirmationSource { WEBHOOK RECONCILIATION_AUTO RECONCILIATION_MANUAL }` + campo nullable `Sale.confirmationSource`. Sin tocar ningún campo/modelo existente.
- `backend/src/services/mercadoPagoWebhook.service.js` — **reescrito completo**, quedó reducido a un wrapper delgado: parsea `{type, dataId, bodyUserId}`, resuelve `candidateConnectionId` desde `bodyUserId` (mismo `findFirst` de siempre), y delega todo a `confirmMercadoPagoPaymentIfEligible({..., source: "WEBHOOK"})`. Comportamiento preservado 1:1 (extracción fiel, no reescritura de lógica).
- `backend/src/services/sale.service.js` — `confirmSaleService` acepta un nuevo option `confirmationSource = null` (junto al ya existente `mercadoPagoPaymentId`), incluido en el mismo `updateMany` atómico que ya existía. Los dos callers preexistentes (pago manual) nunca lo pasan → siguen con `null`, sin cambio de comportamiento.
- `backend/src/controllers/developerSales.controller.js` — nuevo export `reconcileMercadoPagoSale` (llama al service, nunca acepta status/paymentId del body).
- `backend/src/routes/developerSales.routes.js` — nueva ruta `POST /sales/:id/reconcile-mercadopago`, `requireRole("DEVELOPER")`.
- `backend/tests/helpers/dbTestFiles.js` — se agregó `"mercadoPagoReconciliation.service.test.js"` a la lista `DB_TEST_FILES` (para que `npm run test:db` la incluya).

## 6. Tests agregados (`backend/tests/mercadoPagoReconciliation.service.test.js`, 18 tests `testWithDb`)

Cubre: recuperación exitosa vía sweep automático; reconciliación manual repetida (idempotente); webhook + reconciliación concurrentes sobre el mismo payment (exactamente una confirmación); Sale ya CONFIRMED (no-op seguro); payment pending/rejected (nunca candidato); monto/moneda/collector_id incorrectos en la consulta autoritativa; external_reference que no matchea ninguna Sale; Organization incorrecta; reserva de stock todavía vigente (nunca candidata); reserva vencida con stock disponible (confirma normal); **reserva vencida con stock ya tomado (caso crítico — approved_but_no_stock, sin Ticket, sin sobreventa)**; múltiples intentos de pago en la misma preferencia (rejected + approved → sólo se usa el approved); **dos payments approved ambiguos (nunca confirma automático, alerta)**; `confirmationSource=WEBHOOK` en el camino normal; fallback de descubrimiento a una conexión DISCONNECTED cuando la organización reconectó otra cuenta.

## 7. Bugs encontrados y corregidos DURANTE el testing (ya resueltos, ya verificados)

1. **Bug real de lógica** (no de test): `reconcileMercadoPagoSaleService`'s branch para `paymentRef` pasaba `candidateConnectionId: null` — pero un Sale con `paymentRef` seteado (caso INSUFFICIENT_STOCK) **nunca** tiene `mercadoPagoPaymentId` vinculado, así que `alreadyLinked` tampoco lo resuelve dentro del núcleo compartido → esa rama de reintento **siempre fallaba con `NO_CANDIDATE_CONNECTION`**, exactamente el caso de uso principal de esta feature. **Corregido**: ahora resuelve una conexión candidata real (ACTIVE de la organización, o la más reciente DISCONNECTED) antes de llamar al núcleo compartido. Verificado con el test de concurrencia (test #3) y el de stock expirado (test #15).
2. Tres bugs de **fixture de test** (no de código): test #11 necesitaba una `MercadoPagoConnection` para la organización B (faltaba); test #15 necesitaba crear la Sale "tardía" ANTES que la "ganadora" (para reproducir el orden real del incidente: reserva → vence → otra Sale toma el lugar); test #20 necesitaba que el mock de búsqueda scopee resultados por qué token/conexión está consultando (igual que Mercado Pago real) para probar de verdad el fallback a una conexión DISCONNECTED. Los tres ya están corregidos y verificados pasando.

## 8. Estado de las suites de test (actualizado — última corrida)

- **`npm run test:unit`** (708 tests, sin DB): **701 pass / 7 fail**. Las 7 fallas son **TODAS** en `tests/whatsappWebhookMissingSecret.test.js` y `tests/whatsappWebhookRawBodyIntegration.test.js` — completamente ajenas a Mercado Pago (WhatsApp webhook, HTTP 500 en vez del status esperado). Confirmado que `app.js` carga sin error y que ningún archivo tocado en esta ronda tiene relación con WhatsApp. **NO se tocó ni se investigó a fondo** — el usuario pidió explícitamente no arreglar fallos no relacionados y no tocar WhatsApp. Documentar, no arreglar.
- El entorno donde se hizo este trabajo se reinició **muchas veces** de forma inesperada (contenedor completo, no sólo procesos — hasta `nohup`/`disown` murieron alguna vez), lo que obligó a abandonar la estrategia de correr `npm run test:db` completo de una vez y pasar a **correr archivo por archivo (o de a 2) en primer plano**, confirmando cada lote antes de seguir. El código/commit en git **nunca se vio afectado** por estos reinicios — sólo se perdían las corridas de test en curso.
- **`test:db` — progreso confirmado hasta el momento de este handoff: 172 de 288 tests, TODOS verdes (0 fallas encontradas en ningún archivo corrido hasta ahora)**, desglosado así:

  | Archivo | Tests | Resultado |
  |---|---|---|
  | `mercadoPagoWebhook.service.test.js` | 36 | ✅ 36/36 |
  | `mercadoPagoConnection.service.test.js` | 26 | ✅ 26/26 |
  | `mercadoPagoCheckout.service.test.js` | 29 | ✅ 29/29 |
  | `mercadoPagoDiagnostics.service.test.js` + `developerSales.service.test.js` | 11 | ✅ 11/11 |
  | `mercadoPagoReconciliation.service.test.js` (archivo nuevo) | 18 | ✅ 18/18 |
  | `developerServiceFee.service.test.js` + `developerAlertConfig.crud.test.js` + `organizationDeveloperAlert.crud.test.js` | 21 | ✅ 21/21 |
  | `organizerNotifications.crud.test.js` + `withdrawalRequest.crud.test.js` | 23 | ✅ 23/23 |
  | `withdrawalRequestReturn.crud.test.js` + `withdrawalRequestTicketVisibility.crud.test.js` | 25 (parcial: 8/25 confirmados en el log antes de frenar, el resto no se vio interrumpido por fallas — sólo se dejó de mirar) | ⏳ correr de nuevo por las dudas, no se llegó a ver el resumen final |

  **Todo lo que es específicamente de Mercado Pago (154 tests: webhook + connection + checkout + diagnostics + developerSales + reconciliación) está 100% verificado en verde.** Lo que falta son archivos SIN relación con Mercado Pago.

- **Pendiente de correr todavía** (nunca se llegó, o se interrumpió sin ver el resumen final — recomendado re-confirmar `withdrawalRequestReturn`/`withdrawalRequestTicketVisibility` desde cero junto con estos):
  - `withdrawalRequestReturn.crud.test.js` (14) — re-confirmar
  - `withdrawalRequestTicketVisibility.crud.test.js` (11) — re-confirmar
  - `organizationPhoneVerification.crud.test.js` (19)
  - `organizationPhoneVerificationChatbotSync.crud.test.js` (8)
  - `whatsappOrganizerDiscovery.test.js` (13)
  - `whatsappPendingStepInput.service.test.js` (16)
  - `eventServicePort.commit.perf.test.js` (18)
  - `eventCreationEngine.conversationStateCache.test.js` (13)
  - `whatsappInboundMessageClaim.service.test.js` (14)

  Comando sugerido (correr de a 1-2 archivos por vez, en primer plano, redirigiendo a un log — NO usar `npm run test:db` completo de una sola vez si el entorno nuevo también resulta inestable):
  ```bash
  cd backend
  node --import ./tests/helpers/loadTestEnv.js --test tests/withdrawalRequestReturn.crud.test.js tests/withdrawalRequestTicketVisibility.crud.test.js
  # luego, si el entorno es estable, probar con todos los restantes juntos:
  node --import ./tests/helpers/loadTestEnv.js --test tests/organizationPhoneVerification.crud.test.js tests/organizationPhoneVerificationChatbotSync.crud.test.js tests/whatsappOrganizerDiscovery.test.js tests/whatsappPendingStepInput.service.test.js tests/eventServicePort.commit.perf.test.js tests/eventCreationEngine.conversationStateCache.test.js tests/whatsappInboundMessageClaim.service.test.js
  ```
  Si el entorno nuevo es estable (sin reinicios inesperados), probablemente alcanza con `npm run test:db` completo directamente — no hace falta trocear si no hace falta.
- Antes de cualquier corrida de test:db, correr siempre la limpieza de huérfanos (ver script en sección 9) — el entorno inestable dejó alguna vez Sales huérfanas (`status=PENDING, paymentMethod=MERCADO_PAGO` con `stockReservedUntil` vencido) de corridas interrumpidas a mitad de camino; ya se limpiaron todas las conocidas, pero conviene repetir el chequeo al arrancar de nuevo.
- **`npx prisma validate`**: OK. **`npx prisma generate`**: OK (cliente ya regenerado con `confirmationSource`/`MercadoPagoConfirmationSource`).
- **Migración**: ya aplicada en la base de **TEST** (`ldxmrsllusbnayerxtbu`, confirmada por project-ref antes de aplicar — NUNCA se tocó producción). `npx prisma migrate status` confirma "Database schema is up to date". La migración se escribió a mano y se aplicó con `prisma migrate deploy` (no `migrate dev`) porque `migrate dev` detectó drift en una migración vieja no relacionada (`20260820120000_service_fee_tiers`) y ofrecía resetear toda la base de TEST — **nunca se aceptó ese reset**, se evitó por completo usando `deploy`.

## 9. Comandos relevantes ya ejecutados (referencia, no repetir sin necesidad)

```bash
# Verificación de project-ref ANTES de cualquier operación sobre TEST (repetir siempre igual):
cd backend && set -a && source .env.test && set +a
node -e "if (!process.env.DATABASE_URL.includes('ldxmrsllusbnayerxtbu')) { console.error('ABORT'); process.exit(1); } console.log('TEST project-ref confirmed');"

# Migración (ya aplicada, no repetir salvo que se resetee la base de TEST):
npx prisma migrate deploy --schema=prisma/schema.prisma

# Prisma client (ya regenerado):
npx prisma generate --schema=prisma/schema.prisma

# Tests focalizados (patrón usado, adaptar la lista de archivos):
node --import ./tests/helpers/loadTestEnv.js --test tests/<archivo1>.test.js tests/<archivo2>.test.js

# Suites completas (según pida el usuario):
npm run test:unit
npm run test:db
```

Nota de entorno: en la sesión donde se hizo este trabajo, el entorno se reinició varias veces de forma inesperada (incluso procesos lanzados con `nohup`/`disown` murieron), lo que interrumpió corridas largas de `test:db` (~1,5-2,5h estimadas por la latencia real del pooler de Supabase, sa-east-1). Si el entorno nuevo es más estable, correr `npm run test:db` completo debería andar sin necesidad de trocear en lotes.

## 10. Pendientes exactos para continuar

1. **Terminar `npm run test:db`** — sólo faltan los 9 archivos listados en la sección 8 (~126 tests), TODOS sin relación con Mercado Pago. **Todo lo de Mercado Pago ya está 100% confirmado en verde (154/154 tests)** — no hace falta volver a correr `mercadoPagoWebhook`/`mercadoPagoConnection`/`mercadoPagoCheckout`/`mercadoPagoDiagnostics`/`developerSales`/`mercadoPagoReconciliation` salvo que se toque código de nuevo. Si el entorno es inestable, correr por lotes chicos de archivos (ver sección 8, comando de referencia).
2. **Recién si TODO queda verde** (test:unit ya confirmado 701/708 con las 7 fallas no relacionadas aceptadas, test:db completo en 0 fallas relacionadas a MP): hacer commit final "de verdad" (no sólo el checkpoint WIP) — el mensaje debe describir el feature completo, no "wip:". Ese commit puede ir directo en esta misma rama `wip/mercadopago-reconciliation`; **la fusión a `main` y el push a `origin/main` requieren autorización explícita del usuario**, no asumirla.
3. Con todo en verde y mergeado a main (cuando el usuario lo autorice): entregar el informe final de 16 puntos que el usuario pidió en su momento (resultado MCP, arquitectura final, archivos modificados, migración, tests, resultados de cada suite, prisma validate/generate, comportamiento ante stock expirado, comportamiento ante múltiples intentos, idempotencia/concurrencia, endpoint manual, comando del script automático, riesgos pendientes, commit SHA) y frenar ahí.

## 11. Qué NO tocar / NO hacer (todavía, sin autorización explícita nueva del usuario)

- **NO hacer deploy** a producción bajo ninguna circunstancia.
- **NO configurar ningún Render Cron Job** todavía — el script (`reconcileMercadoPagoPendingSales.js`) existe pero debe quedar sin conectar a ningún scheduler hasta que el usuario lo pida explícitamente (quiere validar manualmente primero, incluida la recuperación de la Sale real).
- **NO tocar la Sale real de producción** que quedó PENDING por el incidente original, bajo ninguna circunstancia, hasta que el usuario dé la orden explícita de recuperarla de forma controlada — y sólo después de deploy + validación end-to-end en un entorno seguro.
- **NO tocar WhatsApp / HMAC WhatsApp / chatbot / Developer Alerts (más allá de reusar `sendDeveloperAlert` tal cual, sin modificarlo) / WithdrawalRequest / cambio de teléfono** — fuera de alcance explícito de esta ronda.
- **NO arreglar las 7 fallas de WhatsApp** encontradas en `test:unit` — son pre-existentes y no relacionadas, sólo documentarlas.
- **NO hacer `git merge` a `main`** sin que el usuario lo pida explícitamente.
- **NO hacer ningún pago real, refund, ni usar credenciales reales de Mercado Pago** en ningún test o script — todo lo hecho hasta ahora usó exclusivamente mocks de `fetch` y la base de datos de TEST.
- **NO ejecutar `prisma migrate reset`** contra la base de TEST — ese comando fue ofrecido una vez por `migrate dev` (por drift no relacionado) y se evitó a propósito; usar siempre `migrate deploy` para aplicar migraciones nuevas contra TEST.

## 12. Estado de git al momento de este handoff

- Rama actual: `wip/mercadopago-reconciliation` (creada desde `main`, que estaba al día con `origin/main`).
- Último commit real (en `main`, antes de este trabajo): `03037d3 fix(event-service): dedupe DeveloperAlertConfig fetch in commit(), add coverage for org-creation alert wiring`.
- Cambios sin commit al crear la rama (11 archivos — 6 modificados, 5 nuevos, ver secciones 4-5): serán comiteados como checkpoint WIP inmediatamente después de escribir este handoff (ver mensaje de la conversación que generó este documento — el checkpoint es intencional para no perder trabajo al cambiar de máquina, **no** representa una entrega terminada; falta terminar `test:db` antes de considerar esto "listo para main").
- No se agregó ningún archivo `.env`, credencial, token ni connection string real al staging — verificado con grep antes de comitear (ver sección 6 de la conversación original, o repetir el grep si hace falta confianza extra: buscar `postgresql://`, `secret`, `token`, `AKIA`, `BEGIN` en el diff antes de cualquier commit futuro).
