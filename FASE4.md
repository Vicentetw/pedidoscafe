# Fase 4 — Pedidos y cocina · estado

Sigue `ARQUITECTURA_V1.md` §4.6 (ERD), §5 (máquina de estados de Order), §9 (aviso de
otros pedidos), §2 (eventos). Verificada contra la misma MySQL 8 (Docker) + Firebase real.

## Qué quedó hecho

### Base de datos — `migrations/0005_orders.sql`
- `orders` (`public_id` ULID; `status` = eje operativo; `payment_status` = eje de pago
  **independiente**; `priority`; timestamps `ordered_at…completed_at`).
- `order_items` — con **snapshot de precio congelado** (`unit_price`, `modifiers_total`,
  `line_total`, `name_snapshot`, `variant_snapshot`), `station_id`, `kitchen_status`,
  `age_check` (`NONE|REQUIRED|VERIFIED|REJECTED`).
- `order_item_modifiers` — snapshot de nombre + delta (no depende de que el modifier
  siga existiendo).
- `order_events` — log de cada transición de la máquina de estados.
- `kitchen_stations`, `product_station_routing` (regla por producto / categoría /
  default de sucursal), `kitchen_tickets` + `kitchen_ticket_items`,
  `kitchen_ticket_counters` (número visible por sucursal y día).

### Backend — módulo `orders`
- **`order.stateMachine.js`** — transiciones `DRAFT → SUBMITTED → VALIDATING_STOCK →
  CONFIRMED → QUEUED → PREPARING → READY → DELIVERED → COMPLETED` + `REJECTED_STOCK`,
  `CANCEL_REQUESTED`, `CANCELLED`. `GUEST_CANCELLABLE` (hasta `QUEUED`).
- **`orders.service.js`**:
  - `resolvePricedItem` — resuelve producto/variante/modificadores y **calcula el
    precio con el `pricing.js` del catálogo**. El body sólo trae códigos y cantidad.
  - `addItem` / `updateItem` / `removeItem` — sólo en `DRAFT`. Recalcula el total.
  - **`submitOrder`** — en una transacción con `SELECT ... FOR UPDATE` sobre el pedido:
    `DRAFT → SUBMITTED → VALIDATING_STOCK` → **hook `validateAndReserveStock` (paso-a-
    través en la Fase 4; la reserva pesimista se enchufa en la Fase 5)** → `CONFIRMED`
    → congela totales → **rutea cada ítem a su estación y crea los `kitchen_tickets`**
    → `QUEUED`. Si hay sesión: recalcula `table_sessions.total_amount` y pasa la mesa a
    `SERVING`. Emite `OrderConfirmed` + `KitchenTicketQueued` (outbox) y SSE
    (`orders`, `kitchen`, `session`).
  - `cancelOrder` — el comensal cancela hasta `QUEUED`; el staff hasta `PREPARING`
    (con `orders:cancel_after_prep`); borra los tickets, recalcula el total de la
    mesa, audita.
  - `setPriority`, `verifyAge` (§28: el pedido **no pasa a `DELIVERED`** con una
    verificación de edad pendiente), `completeOrder`.
  - `listGuestOrders` — **privacidad (§9)**: `mine` con líneas completas;
    `othersSummary` sólo con cantidad y total (sin ítems); `someoneElseOrdering`
    cuando otro participante tiene un borrador abierto.
- **`kitchen.service.js`** — estaciones y ruteo (setup, `tables:manage`); tablero
  (`kitchen:view`); **`advanceTicket`** (`kitchen:advance_ticket`): avanza el ticket
  un paso y **recalcula el estado del pedido siguiendo al ticket menos avanzado**,
  moviéndose un estado por vez; `DELIVERED` del pedido bloqueado por `age_check`.
- **Rutas**:
  - `/api/orders/*` — staff / mostrador (`orders:view/create/amend/cancel/
    cancel_after_prep/set_priority`).
  - `/api/session/orders/*` — comensal, gateado por el `table_session_token`; un
    participante sólo edita **su** pedido.
  - `/api/kitchen/*` — KDS + setup de estaciones.
- Nuevo campo en `GET /api/platform/users/me`: `tenantSlug` (lo usa el front para el
  menú de mostrador).

### Frontend
- `client/order-panel.ts` — dentro de `/t/:token`: menú → tocar para sumar a un
  borrador → confirmar → seguimiento de "Mis pedidos" con estado; muestra el total de
  la mesa y el aviso de "otra persona pidiendo".
- `staff/order-entry.ts` (`/staff/mostrador`) — alta de pedidos de mostrador.
- `staff/staff-kds.ts` (`/staff/cocina`) — tablero real: tickets por estación, botón
  para avanzar, refresco periódico.

## Verificado

- `npm run migrate` — `0005_orders.sql` aplica limpio (8 tablas).
- **`npm test` → 106 pass, 0 fail, 0 skip.** Nuevo en la Fase 4 (27 tests):
  - **`order-state.test.js`** (6) — ciclo normal, rechazo de stock, cancelación,
    transiciones prohibidas (`QUEUED↛READY`, `READY↛CANCELLED`).
  - **`orders-flow.test.js`** (7, comensal, sin Firebase) — **el precio lo pone el
    backend e ignora un `unit_price` inyectado** (mandatory case #4); submit →
    `CONFIRMED/QUEUED` + ticket + suma al total de la mesa; un pedido enviado no se
    edita; avanzar el ticket arrastra `PREPARING → READY → DELIVERED`; **caso
    obligatorio 6** (dos participantes, dos pedidos, una misma `TableSession`);
    privacidad (`othersSummary` sin líneas); un comensal no edita el pedido de otro.
  - **`orders-kitchen.test.js`** (3) — ítems de dos estaciones → dos tickets; el
    pedido **no** pasa a `DELIVERED` con edad sin verificar; sucursal sin estaciones →
    un ticket general (`station_id NULL`).
  - **`orders-isolation.test.js`** (5) — dos empresas con producto de igual código: un
    pedido de A nunca se resuelve/lista bajo B; el precio usa el catálogo de A.
  - **`orders-admin.test.js`** (6, HTTP con token real) — `mozo` crea/edita/envía;
    `mozo` **no** cancela (403) ni cambia prioridad (403); el `encargado` sí (y queda
    auditado); el KDS avanza tickets con `kitchen:advance_ticket` (mozo 403).
- `ng build` (dev y prod) OK con `order-panel`, `order-entry`, KDS.

## Cerrado de los 8 casos obligatorios

- **Caso 4** (cliente no puede fijar el precio) — reforzado a nivel pedido (guest y
  staff, HTTP).
- **Caso 6** (dos personas piden desde la misma mesa) — **cubierto**: dos participantes,
  dos `orders` con el mismo `session_id`, distinto `participant_id`, sin pisarse.

## Próximo: Fase 5 — Stock

`ingredients`, `recipes`, `stock`, `stock_movements` (ledger), `stock_reservations`.
Se enchufa la **reserva pesimista `SELECT ... FOR UPDATE`** en el hook
`validateAndReserveStock` de `orders.service.js` (ya preparado como seam). Cubre los
**casos obligatorios 1 y 8** (stock = 1 con dos compras simultáneas; producto que se
agota mientras alguien ve el menú).
