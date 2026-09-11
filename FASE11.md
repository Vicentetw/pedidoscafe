# Fase 11 — Promociones · estado

Sigue `ARQUITECTURA_V1.md` §4.8 (promociones, reglas, canjes). Primer consumidor
real de `customers`/`loyalty_tiers` (Fases 9-10): la condición `CUSTOMER_TIER`.
Verificada contra la misma MySQL 8 (Docker) + Firebase real.

## Qué quedó hecho

### Base de datos — `migrations/0012_promotions.sql`
- `promotions` — código único por tenant, tipo, valor, prioridad, combinable
  o no, ventana de vigencia, estado ACTIVE/INACTIVE.
- `promotion_rules` — condiciones **AND entre sí** (una promo con varias filas
  exige todas): `BRANCH`, `CATEGORY`, `PRODUCT`, `TIME`, `DAY`, `MIN_QTY`,
  `CUSTOMER_TIER`, `MIN_AMOUNT` — mismo enum que `ARQUITECTURA_V1`.
- `promotion_redemptions` — un canje por pedido y promoción
  (`UNIQUE(tenant_id, order_id, promotion_id)`, aplicar dos veces es
  idempotente). Guarda un **snapshot** de código/tipo/valor/prioridad/
  combinable al momento de aplicar (mismo criterio que
  `order_items.name_snapshot`): si la promoción se edita o desactiva después,
  el descuento ya aplicado a ese pedido no cambia solo.
- **Sin permiso nuevo**: `promotions:view`/`promotions:manage` ya estaban
  sembrados desde la Fase 1 — sólo para dueño/admin/stock/auditor (el resto
  del staff NO navega el catálogo de promos). Aplicar un código a un pedido
  usa `orders:amend` (modificar el pedido), que sí tiene mozo/cajero/encargado.

### Backend
- **Alcance deliberado**: sólo `PERCENT` y `FIXED` tienen motor de cálculo.
  `BOGO`/`COMBO`/`FREE_ITEM`/`HAPPY_HOUR` están en el enum (fiel al schema de
  `ARQUITECTURA_V1`) pero crear una promoción de esos tipos se rechaza con un
  mensaje explicando por qué: elegir **qué ítem puntual** se regala o combea
  es una decisión de producto que no está tomada (¿lo elige el staff? ¿el más
  barato de los elegibles?) — inventar un criterio sería adivinar. Mismo
  espíritu que AFIP (Fase 8) o CRM sin "segmentos" (Fase 9): se construye lo
  que tiene un diseño claro y se documenta honestamente lo que no.
- `promotions.service.applyPromotion(tenantId, orderId, code, actor)` —
  valida vigencia, condiciones (una por una, con mensaje humano de cuál
  falló), combinabilidad (una promo no combinable debe ser la única del
  pedido), y que el pedido siga `UNPAID`. El monto del descuento **nunca lo
  manda el cliente** — la única entrada es el código; todo el cálculo sale
  del catálogo, mismo criterio que el caso obligatorio 4 (precio inyectado).
- **El descuento sobrevive a agregar/sacar ítems después de aplicar una
  promo**: `orders.service.js` (en `addItem`/`updateItem`/`removeItem`/
  `submitOrder`, los 4 puntos donde ya recalculaba `subtotal`/`total`) ahora
  llama a `promotions.service.recomputeDiscountForOrder(...)` justo después
  — no-op barato si el pedido no tiene ninguna promo aplicada, y si tiene una
  o más, las vuelve a calcular sobre el subtotal actual y reescribe
  `discount_total`/`total`. Sin este enganche, cualquier edición de ítems
  después de aplicar una promo pisaba el descuento a `$0` en silencio — **un
  test lo agarró en la primera pasada** (ver "Verificado").
- Integración con `orders.service.js` sin ciclo de `require`: `orders.service`
  importa `promotions.service` (una sola dirección); `promotions.service`
  sólo importa `orders.repository` (no `orders.service`) a nivel de módulo, y
  pide `getOrder` con un `require` diferido dentro de la función que lo usa
  — mismo patrón ya usado para evitar ciclos en este código base.

### Frontend
- `admin/promotions-page.ts` (`/admin/promociones`) — alta de promos PERCENT/
  FIXED, agregar condiciones (con ejemplos de formato para cada tipo),
  pausar/activar.
- `staff/order-entry.ts` (mostrador) — campo "código de promo" + botón
  Aplicar, con el subtotal/descuento/total mostrados aparte.

## Verificado

- `npm run migrate` — `0012_promotions.sql` aplica limpio (3 tablas nuevas).
- **`npm test` → 213 pass, 0 fail, 0 skip.** 17 tests nuevos en la Fase 11:
  - **`promotions-flow.test.js`** (12) — rechaza crear BOGO/COMBO/FREE_ITEM/
    HAPPY_HOUR; PERCENT y FIXED calculan bien (FIXED nunca deja el total
    negativo); aplicar la misma promo dos veces es idempotente; **el
    descuento se recalcula al agregar otro ítem**; sacar la promoción vuelve
    el descuento a $0; `MIN_AMOUNT` rechaza/permite según corresponda; una
    promo no combinable bloquea combinarse con otra; dos combinables se
    suman; `CUSTOMER_TIER` exige el nivel (y rechaza sin cliente
    identificado); no se puede tocar los descuentos de un pedido ya pagado.
  - **`promotions-isolation.test.js`** (4) — el mismo código en dos empresas
    no choca; A nunca ve/aplica la promo de B.
  - **`promotions-admin.test.js`** (1, HTTP con token real) — mozo no puede
    crear ni listar promociones, pero sí aplicar un código conocido al pedido
    que está tomando (`orders:amend`).
- Se re-corrió además `orders`/`stock`/`payments`/`fiscal`/`crm`/`loyalty`
  (54 tests) por tocar `orders.service.js` en los 4 puntos de recálculo de
  totales — sin regresiones.
- `ng build --configuration production` OK con `promotions-page` y el campo
  de código de promo en `order-entry`.
- **Bug real encontrado por el propio test suite, en la primera pasada**:
  sacar la ÚLTIMA promoción de un pedido no volvía a escribir `discount_total`
  (el atajo "no-op si no hay canjes" de `recomputeDiscountForOrder` se
  aplicaba también en el momento en que el canje recién se había borrado, así
  que el descuento viejo quedaba pisado para siempre). Corregido con un flag
  `force` que `removePromotion` pasa explícitamente para ese caso.

## Próximo: Fase 12 — Inteligencia / analítica

`daily_sales_rollup`/`product_sales_rollup` (consultas directas al inicio, sin
motor de BI) sobre todo lo construido hasta acá — el primer módulo que LEE de
absolutamente todas las fases anteriores sin escribir en ninguna.
