# Fase 12 — Inteligencia / analítica · estado

Sigue `ARQUITECTURA_V1.md` §4.11 ("al inicio, consultas directas") y
`prompt.txt` §51. Verificada contra la misma MySQL 8 (Docker) + Firebase real.

## Qué quedó hecho

### Base de datos — `migrations/0013_analytics.sql`
- `daily_sales_rollup` / `product_sales_rollup` — el esquema exacto de
  `ARQUITECTURA_V1`. **No son el camino principal de esta fase** (ver abajo):
  existen y se pueden poblar (`POST /api/analytics/rollup/recompute`), pero
  el dashboard lee directo de `orders`/`order_items`/`refunds`.
- Sin permiso nuevo: `reports:view_sales`/`view_profit`/`view_audit` ya
  estaban sembrados desde la Fase 1.

### Backend — módulo `analytics` (sólo lectura de otros módulos)
- **KPIs con datos reales, sin inventar nada**: GMV (bruto), neto (bruto -
  descuentos), descuentos, devoluciones, pedidos, ticket promedio, clientes
  distintos, repeat rate, minutos de preparación promedio (de
  `accepted_at`/`ready_at`, que ya existían desde la Fase 4) y top productos
  por ingreso.
- **Alcance deliberadamente acotado** (mismo criterio que AFIP en la F8 o
  BOGO en la F11): del pedido de `prompt.txt` §51 quedan afuera **Food
  Cost**, **Gross Margin** y **Stock Turnover** — `purchase_items.unit_cost`
  es el costo de CADA compra, no hay un "costo actual" del ingrediente, y
  elegir un método (FIFO, promedio, último precio) es una decisión de
  producto que no está tomada. **LTV** y **Conversion** también quedan
  afuera: necesitan datos que este sistema no registra (tráfico/visitas al
  menú, valor de vida más allá de lo que ya se ve en `repeatRate`).
- **Por qué "consultas directas" y no el rollup como fuente principal**: a
  esta escala, agregar sobre `orders` con un índice por
  `(tenant_id, branch_id, ...)` es rápido y **siempre exacto** — no hay nada
  que invalidar ni que se desincronice. El rollup queda listo (tablas +
  función de recómputo) para cuando el volumen lo pida, pero adoptarlo ahora
  como fuente de verdad sumaría un problema de caducidad que hoy no hace
  falta resolver.
- **Bug real (de otra fase, no de analítica) que encontró el test suite**:
  una devolución **parcial** deja `orders.payment_status` en `'PARTIALLY_PAID'`
  — el mismo string que usa un pedido que **todavía** se está cobrando (así
  viene desde la Fase 6; no se tocó acá, cambiar esa máquina de estados es
  aparte). Consecuencia práctica: el resumen de ventas, que filtra por
  `payment_status = 'PAID'`, deja de contar el pedido entero (no sólo el
  monto devuelto) apenas tiene una devolución parcial — aunque
  `summary.refunds` sí lo sigue mostrando (sale de la tabla `refunds`
  directo). Documentado y cubierto por un test explícito
  (`analytics-flow.test.js`) para que no se lea como un bug de esta fase si
  alguien lo nota más adelante.

### Frontend
- `admin/analytics-page.ts` (`/admin/analitica`) — selector de sucursal +
  rango de fechas, tarjetas de KPIs, top productos y serie por día.

## Verificado

- `npm run migrate` — `0013_analytics.sql` aplica limpio (2 tablas nuevas).
- **`npm test` → 223 pass, 0 fail, 0 skip.** 10 tests nuevos en la Fase 12:
  - **`analytics-flow.test.js`** (7) — un draft sin pagar no cuenta;
    gross/discounts/net/clientes/repeat rate correctos sobre lo `PAID`;
    **la devolución parcial documentada arriba**, cubierta explícitamente;
    top-products rankea por ingreso, no por cantidad; la serie diaria agrupa
    bien por fecha (un pedido de ayer no entra en el resumen de hoy);
    `recomputeRollup` puebla las tablas y coincide con la consulta directa;
    una sucursal inexistente da un error de validación, no un 500.
  - **`analytics-isolation.test.js`** (2) — el resumen y el top de productos
    de A nunca ven nada de B (precios bien distintos para que se note si se
    mezclaran).
  - **`analytics-admin.test.js`** (1, HTTP con token real) — un mozo no
    puede ver el resumen de ventas (`reports:view_sales`); un encargado sí.
- `ng build --configuration production` OK con `analytics-page` nueva.

## Próximo: Fase 13 — Hardware (buzzers)

Última fase del roadmap original. `devices`/`device_assignments` ya están en
el ERD (§4.9, construidas conceptualmente pero no implementadas todavía) —
notificar a un buzzer físico cuando un pedido está listo. Alcance realista:
sin hardware real disponible en este entorno, se construye el protocolo/API
completo (asignar buzzer a pedido, notificar, liberar) y una integración por
webhook/MQTT documentada como seam, mismo criterio honesto que AFIP/MercadoPago.
