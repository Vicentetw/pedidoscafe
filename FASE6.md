# Fase 6 — Pagos · estado

Sigue `ARQUITECTURA_V1.md` §4.7 (ERD), §6 (máquina de estados de Payment), §10-12
(pago individual/conjunto/dividido), §12 (flujo MercadoPago). Verificada contra la
misma MySQL 8 (Docker) + Firebase real de las fases anteriores.

## Qué quedó hecho

### Base de datos — `migrations/0007_payments.sql`
- `payments` (`external_reference` único, `provider_ref`, `kind` SESSION_GROUP /
  SESSION_INDIVIDUAL / SESSION_SPLIT / ORDER / COUNTER).
- `payment_allocations` (qué cubre cada pago — participante o "la mesa" en general).
- `payment_transactions` (historial con el proveedor: AUTHORIZE/CAPTURE/REFUND).
- **`mp_webhook_events`** — idempotencia de notificaciones de MercadoPago.
- `refunds`.

### `PaymentProvider` con adapters
- **`providers/cash.provider.js`** — liquida en el momento, sin red.
- **`providers/mercadopago.provider.js`** — **reusa la fórmula de firma exacta** del
  `verifyWebhookSignature` del sistema de asistencia (probada en producción).
  **Decisión de implementación**: usa la API de **Preferences / Checkout Pro**
  (`POST /checkout/preferences`), no todavía la Orders API que menciona el prompt
  original — es la integración de pagos online más estable y documentada de
  MercadoPago, y la única que se puede validar estructuralmente **sin credenciales
  reales** (no hay cuenta de MercadoPago en este entorno). El resto del sistema sólo
  conoce la interfaz (`createCheckout` / `fetchPaymentStatus` / `refund` /
  `verifyWebhookSignature`) — migrar a Orders API / QR dinámico es cambiar este
  archivo, no tocar `payments.service.js` ni nada río abajo.

### `payments.service.js` — el motor
- **`chargeSession`** — el monto se calcula **DENTRO** de una transacción con
  `SELECT ... FROM table_sessions ... FOR UPDATE`: GRUPAL = `total - pagado`;
  INDIVIDUAL = `Σ pedidos del participante - Σ ya pagado por ese participante`;
  DIVIDIDO = monto explícito, no puede superar el saldo. Si el saldo ya es 0 →
  rechaza con `ALREADY_PAID` (lenguaje humano). **Efectivo liquida en la misma
  transacción** (nunca hay lock abierto durante una llamada de red). **MercadoPago**
  sólo reserva el registro `CREATED` dentro del lock; el checkout se pide DESPUÉS,
  fuera de la transacción — nunca se sostiene un lock de fila mientras se espera a
  una API externa.
- **`applyApprovedAmount`** — recalcula el saldo **fresco** dentro del lock antes de
  sumar; si un monto haría que `paid_amount` superara `total_amount`, el excedente
  **no se acredita** — se acredita sólo hasta el total y el resto queda como
  `refunds` `PENDING` (protección contra doble cobro real, ej. dos aprobaciones de
  MercadoPago para el mismo saldo).
- **`splitEqual`** — dividir en partes iguales, efectivo (el reparto por
  MercadoPago se resuelve con pagos `INDIVIDUAL`, uno por persona).
- **`chargeOrder`** — cobro directo de un pedido de mostrador (`orders.payment_status`).
- **`processMpWebhookNotification`** — idempotencia por `topic:data.id` (MercadoPago
  no da un id de notificación único y estable en todos los tópicos); **nunca confía
  en el payload**: re-consulta el estado real con `fetchPaymentStatus`. Si la
  notificación ya se procesó (o dos llegan en simultáneo y chocan contra el
  `UNIQUE` de `mp_webhook_events`), se descarta sin reprocesar.
- **`refundPayment`** — devolución total o parcial, ajusta el saldo de la mesa
  (`PAID → PARTIALLY_PAID` si corresponde) o el `payment_status` del pedido.
- **`syncSessionStatus`** — sube `table_sessions` hacia `BILL_REQUESTED` →
  `PARTIALLY_PAID` / `PAID` según el saldo, usando la máquina de estados de la
  Fase 3 (se le agregó la transición de vuelta `PAID → PARTIALLY_PAID` para una
  devolución parcial antes de cerrar la mesa).

### Rutas
- `/api/payments/*` — staff (`payments:view/charge/refund`): saldo de la mesa,
  cobrar (grupal/individual/dividido), dividir en partes iguales, cobrar un pedido
  de mostrador, devoluciones.
- `/api/session/payments/*` — comensal, gateado por el `table_session_token`. **Sólo
  puede pagar lo suyo o toda la mesa, y sólo online** — el `provider` lo decide
  siempre el servidor (`MERCADOPAGO`), nunca el body.
- **`/webhooks/mercadopago`** — montado con `express.raw()` **antes** de
  `express.json()` (necesita el body crudo para la firma). Firma inválida → 401;
  cualquier otro error nuestro → 200 (evita una tormenta de reintentos de MP).

### Frontend
- `client/order-panel.ts` — sección "Pagar": saldo pendiente, "Pagar mi parte" /
  "Pagar toda la mesa" (redirige al checkout de MercadoPago cuando está configurado).
- `admin/payments-page.ts` (`/admin/caja`) — mesas abiertas, saldo por persona,
  cobrar en efectivo (grupal / individual / dividido en partes), ver pagos y hacer
  devoluciones.

## Verificado

- `npm run migrate` — `0007_payments.sql` aplica limpio (5 tablas).
- **`npm test` → 146 pass, 0 fail, 0 skip.** 25 tests nuevos en la Fase 6:
  - **`payment-state.test.js`** — máquina de estados (efectivo `CREATED→APPROVED`
    directo; el resto respeta el ciclo online).
  - **`payments-flow.test.js`**:
    - **CASO OBLIGATORIO 7** — tres personas pagan su parte por separado (efectivo)
      → la mesa queda exactamente saldada (`paid_amount == total_amount`, `PAID`); un
      4º intento sobre una cuenta ya saldada se rechaza.
    - **CASO OBLIGATORIO 2** — dos cobros GRUPALES simultáneos sobre la misma mesa
      (`Promise.allSettled`) → **sólo uno se concreta**, el otro se rechaza con
      `ALREADY_PAID`; `paid_amount` nunca supera `total_amount`.
    - Dividir en partes iguales: la suma de las partes da exactamente el total.
    - Devolución parcial: baja el saldo pagado y la mesa vuelve a `PARTIALLY_PAID`.
    - Cobro de un pedido de mostrador; no se puede cobrar dos veces.
    - El comensal **sólo** puede pagar online — sin `MP_ACCESS_TOKEN` configurado
      (no hay credenciales reales en este entorno), el intento falla con
      `MP_NOT_CONFIGURED`, nunca cae a efectivo aunque el body lo pida.
  - **`payments-webhook.test.js`** (firma real, `fetchPaymentStatus` mockeado para no
    depender de red hacia MercadoPago):
    - Firma inválida → 401, no se procesa nada.
    - Firma válida + pago aprobado → aplica al saldo de la mesa.
    - **CASO OBLIGATORIO 3** — la misma notificación llega dos veces → **una sola
      transacción**, `mp_webhook_events` con una sola fila.
    - Un segundo pago aprobado sobre una mesa ya saldada → el pago en sí queda
      `APPROVED` (el dinero se cobró de verdad) pero el saldo de la mesa **nunca**
      supera el total; el excedente queda como `refunds` `PENDING`.
  - **`payments-isolation.test.js`** — cobrar en la empresa A no toca el saldo de B.
  - **`payments-admin.test.js`** (HTTP, token real) — un `mozo` no ve el saldo ni
    cobra ni hace devoluciones (403); el `cajero` sí.
- `ng build` (dev y prod) OK con `order-panel` (pagar) y `payments-page` (caja).

## Los 8 casos obligatorios — completos

| # | Caso | Fase |
|---|---|---|
| 1 | Stock = 1, dos compras simultáneas → sólo una gana | 5 |
| 2 | Dos pagos simultáneos → sin doble cobro | **6** |
| 3 | Webhook dos veces → una transacción | **6** |
| 4 | Cliente intenta modificar el precio → rechazado | 2 / 4 |
| 5 | Usuario de empresa A accede a empresa B → 403/404 | 1 (+ todas) |
| 6 | Dos personas piden desde la misma mesa | 3 / 4 |
| 7 | Tres pagos parciales → cuenta saldada | **6** |
| 8 | Producto se agota mientras alguien ve el menú | 5 |

## Qué falta para pagos reales con MercadoPago

Este entorno no tiene una cuenta de MercadoPago. Para probar el checkout de verdad:
1. Crear una aplicación en el [panel de desarrolladores de MercadoPago](https://www.mercadopago.com.ar/developers/panel).
2. `MP_ACCESS_TOKEN` (credencial de prueba primero) y `MP_WEBHOOK_SECRET` (de la
   configuración de webhooks de la aplicación) en el `.env`.
3. Configurar la URL de notificaciones apuntando a `/webhooks/mercadopago` (necesita
   un túnel público — `ngrok`/`cloudflared` — mientras se desarrolla en local).
4. La lógica de negocio (saldo, idempotencia, split) ya está probada sin esto; lo que
   falta probar es únicamente la integración de red real con MercadoPago.

## Próximo: Fase 7 — POS / Caja

`cash_registers`, `cash_sessions` (apertura/cierre/arqueo), `cash_movements`,
conciliación MercadoPago (cron + dashboard: venta sin pago / pago sin venta / doble /
monto distinto). El módulo `payments` ya deja `payment_transactions` como base para
esa conciliación.
