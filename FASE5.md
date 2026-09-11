# Fase 5 — Stock · estado

Sigue `ARQUITECTURA_V1.md` §4.4 (ERD), §8 (flujo de stock), §11-12 (concurrencia).
El corazón de la fase es la **reserva pesimista** en el `submit` del pedido.
Verificada contra la misma MySQL 8 (Docker) + Firebase real.

## Qué quedó hecho

### Base de datos — `migrations/0006_inventory.sql`
- `ingredients` (`unit`, `is_tracked`), `recipes` (`yield_qty`) + `recipe_items`
  (cuánto ingrediente por rinde).
- **`stock`** (por `(tenant_id, branch_id, ingredient_id)`) — `qty_on_hand`,
  `qty_reserved`. **Es la fila que se bloquea con `SELECT ... FOR UPDATE`.**
- **`stock_movements`** — ledger append-only: `PURCHASE | RESERVE | RELEASE | CONSUME |
  ADJUST | WASTE | TRANSFER_*`, `qty` con signo.
- **`stock_reservations`** — `ACTIVE | CONSUMED | RELEASED`, con `expires_at`.
- `suppliers`, `purchases`, `purchase_items` (ingreso de stock).

### Backend
- **`modules/inventory/stock.service.js`** — el motor:
  - **`reserveForOrder`** (dentro de la transacción del `submit`): resuelve
    receta→ingredientes por ítem, agrega por ingrediente, hace
    `SELECT ... FROM stock WHERE ... FOR UPDATE` **ordenado por `ingredient_id`**
    (anti-deadlock), verifica `qty_on_hand - qty_reserved >= necesidad`; si falta,
    devuelve `{ ok:false, unavailable:[{name}] }` (sin escribir nada); si alcanza,
    sube `qty_reserved`, inserta la `stock_reservation` y un movimiento `RESERVE`.
  - **`releaseForOrder`** (cancelación / rechazo / timeout): baja `qty_reserved`,
    reserva → `RELEASED`, movimiento `RELEASE`.
  - **`consumeForOrder`** (al entregar): baja `qty_on_hand` **y** `qty_reserved`,
    reserva → `CONSUMED`, movimiento `CONSUME`.
  - `availabilityForProducts` — `min` sobre los ingredientes de la receta de
    `floor((on_hand - reserved) / qty_por_unidad)`; UX del menú, no bloquea.
- **`orders.service.js`** — el hook `validateAndReserveStock` (que en la Fase 4 era
  paso-a-través) ahora llama a `reserveForOrder`. Al rechazar: emite SSE
  `menu.availability_changed` / `session.menu_availability_changed` y tira un
  `DomainError` **status 200** con **lenguaje humano** ("Justo se agotó: …") — nunca
  un 409 crudo (§59). `cancelOrder` llama a `releaseForOrder`.
- **`kitchen.service.js`** — cuando el pedido llega a `DELIVERED`, llama a
  `consumeForOrder` dentro de la misma transacción.
- **`modules/inventory/inventory.routes.js`** (`/api/inventory`): ingredientes,
  recetas por producto, stock por sucursal, movimientos (ledger), **ajuste manual**
  (`ADJUST` / `WASTE`, con motivo, auditado), **compras** (suben stock con
  `PURCHASE`), proveedores. Permisos `inventory:view / adjust / purchase /
  manage_recipes`.
- **`jobs/releaseExpiredReservations.js`** — worker (cada 60 s) que libera las
  reservas `ACTIVE` vencidas (`expires_at < now`). Registrado en `server.js`.
- El menú público ahora trae `available` y `stockRemaining` por producto.

### Frontend
- `admin/stock-page.ts` (`/admin/stock`) — existencias por sucursal (en stock /
  reservado / disponible, marca los que están bajo el punto de reposición), alta de
  ingredientes, ajuste manual, y el ledger de movimientos.
- El panel de pedido del comensal ya muestra "Sin stock" cuando `available` es false.

## Verificado

- `npm run migrate` — `0006_inventory.sql` aplica limpio (9 tablas).
- **`npm test` → 121 tests, 0 fail.** Nuevo en la Fase 5:
  - **`stock-reservation.test.js`** — **CASO OBLIGATORIO 1**: `stock = 1`, dos
    `submit` simultáneos (`Promise.allSettled`) → **uno `QUEUED`, uno
    `REJECTED_STOCK`**, `qty_reserved == 1`, **una sola** reserva `ACTIVE`. Además:
    producto sin receta no toca stock; cancelar libera (`RELEASE`); entregar consume
    (`CONSUME`, baja `on_hand` y `reserved`); el ledger reconstruye el `on_hand`.
  - **`stock-menu.test.js`** — **CASO OBLIGATORIO 8**: el sándwich figura disponible
    con `stockRemaining`; al agotarse, el menú lo muestra **no disponible**; el
    `submit` lo rechaza con **lenguaje humano** y deja el pedido en `REJECTED_STOCK`;
    repuesto el stock, el mismo pedido se reenvía y confirma.
  - **`stock-isolation.test.js`** — dos empresas con ingrediente de igual código:
    reservar en A no toca el stock de B; `availabilityByProduct` de A no ve recetas
    de B.
  - **`stock-admin.test.js`** (HTTP, token real) — el rol `stock` crea ingrediente,
    define receta y carga una compra que sube el stock; ajuste manual → `ADJUST` +
    auditoría; un `mozo` no puede ver ni tocar el stock (403).
- `ng build` (dev y prod) OK con la pantalla de Stock.

## Los 8 casos obligatorios

| # | Caso | Estado |
|---|---|---|
| 1 | Stock = 1, dos compras simultáneas → sólo una gana | ✅ Fase 5 |
| 2 | Dos pagos simultáneos → sin doble cobro | Fase 6 |
| 3 | Webhook dos veces → una transacción | Fase 6 |
| 4 | Cliente intenta modificar el precio → rechazado | ✅ Fases 2 y 4 |
| 5 | Usuario de empresa A accede a empresa B → 403/404 | ✅ Fase 1 (+ cada fase) |
| 6 | Dos personas piden desde la misma mesa | ✅ Fase 3-4 |
| 7 | Tres pagos parciales → cuenta saldada | Fase 6 |
| 8 | Producto se agota mientras alguien ve el menú | ✅ Fase 5 |

## Próximo: Fase 6 — Pagos

`PaymentProvider` + adapters (MercadoPago Orders/QR, Cash), `payments` +
`payment_allocations` + `payment_transactions`, `mp_webhook_events` (idempotencia),
webhook con body crudo + firma verificada, máquina de estados de `Payment`, pago
individual / conjunto / dividido / mixto con `SELECT ... FOR UPDATE` sobre
`table_sessions`, propinas, cierre de sesión con saldo 0. Cubre los **casos
obligatorios 2, 3 y 7**.
