# Fase 10 — Fidelización · estado

Sigue `ARQUITECTURA_V1.md` §4.8 (niveles, cuentas, ledger de puntos). Verificada
contra la misma MySQL 8 (Docker) + Firebase real.

## Qué quedó hecho

### Base de datos — `migrations/0011_loyalty.sql`
- `loyalty_tiers` — niveles (`min_points`, `multiplier`, `benefits` JSON).
- `loyalty_accounts` — una cuenta por cliente (`UNIQUE(tenant_id, customer_id)`),
  con `points_balance` como **caché mantenida transaccionalmente** junto con
  cada fila del ledger (se lockea la cuenta con `FOR UPDATE`, se escribe la
  transacción, se actualiza el caché — misma técnica que la reserva de stock).
- `loyalty_transactions` — el ledger real; **nunca se pisa un balance a mano**.
  `UNIQUE(tenant_id, ref_type, ref_id, type)` hace que acreditar el mismo pago
  dos veces (un reintento) sea idempotente en vez de duplicar puntos.
- `loyalty_rules` — puntos por cada $1 de compra; una regla activa a la vez
  (mismo criterio que `is_default` en las alícuotas de IVA, Fase 8).
- **Sin permiso nuevo**: `loyalty:view`/`loyalty:adjust` ya estaban sembrados
  desde la Fase 1. Niveles y regla (configuración del negocio, no una
  operación diaria) reusan `settings:manage` — mismo criterio que las
  alícuotas de IVA en la Fase 8.

### Backend — módulo `loyalty`
- Ganar/canjear/ajustar puntos a mano (`loyalty:adjust`), siempre auditado con
  motivo. Canjear más de lo disponible se rechaza (`409`), nunca deja el
  balance en negativo.
- El nivel se resuelve como **el más alto cuyo mínimo no supera el balance**
  (sin superponerse), y su `multiplier` se aplica al ganar puntos.
- **Acumulación automática**, con un alcance deliberadamente acotado: se
  engancha en `payments.service.js` (cobro en efectivo y webhook de
  MercadoPago) **sólo para pedidos de mostrador con un cliente ya identificado**
  (`orders.customer_id`, Fase 9) — atribución inequívoca, un pedido = un
  cliente. Para mesas con varios comensales, **no** se inventó una heurística
  de reparto de puntos entre los guests linkeados (no hay un criterio obvio:
  ¿se reparten, se le dan todos a quien pidió la cuenta?) — ahí sumar puntos
  queda como acción manual del staff (`POST /accounts/:id/earn`), igual que en
  un comercio real donde el cliente muestra su tarjeta de socio al pagar.
- Sin regla activa configurada, cobrar sigue funcionando exactamente igual,
  simplemente sin sumar puntos — no bloquea nada (mismo espíritu que "sin AFIP
  configurado, sigue emitiendo ticket").

### Frontend
- Panel de fidelización dentro de `admin/crm-page.ts` (`/admin/clientes`):
  balance + nivel del cliente seleccionado, ledger de movimientos, y
  sumar/canjear/ajustar puntos (sólo con `loyalty:adjust`).

## Verificado

- `npm run migrate` — `0011_loyalty.sql` aplica limpio (4 tablas nuevas).
- **`npm test` → 196 pass, 0 fail, 0 skip.** 13 tests nuevos en la Fase 10:
  - **`loyalty-flow.test.js`** (7) — sin regla activa no acredita nada; con
    regla activa, cobrar un pedido de mostrador con cliente acredita los
    puntos justos; un pedido sin cliente no rompe nada; canjear resta (y
    rechaza canjear de más sin tocar el balance); un ajuste manual suma/resta
    con motivo; el nivel resuelto sigue al balance; **acreditar el mismo pago
    dos veces (reintento) no duplica puntos**.
  - **`loyalty-isolation.test.js`** (4) — el mismo código de nivel en dos
    empresas no choca; A nunca ve el balance/ledger de B; ajustar la cuenta de
    un cliente de otro tenant no lo encuentra.
  - **`loyalty-admin.test.js`** (2, HTTP con token real) — cajero puede
    consultar el saldo (`loyalty:view`) pero no ajustarlo ni crear niveles; el
    dueño sí.
  - **`crm-flow.test.js`/`crm-isolation.test.js`/`crm-admin.test.js`** (4 ya
    existentes de la Fase 9) se re-corrieron sin cambios.
- Se re-corrió además la suite de `orders`/`stock`/`payments`/`fiscal` (47
  tests) por tocar `orders.repository` (se agregó `customer_id` a
  `ORDER_COLS`) y `payments.service` (los dos hooks de acumulación
  automática) — sin regresiones.
- `ng build --configuration production` OK con el panel de fidelización nuevo.
- **Bug real encontrado al escribir el test de permisos**: el test asumía que
  `mozo` tenía `loyalty:view` iguál que `crm:view`; en realidad el seed de
  roles (0002, ya existente de la Fase 1) sólo le da `loyalty:view` a
  `cajero`/`encargado`/`admin*`/`owner` — no es un bug del sistema, era una
  suposición incorrecta del test. Corregido para usar `cajero`.

## Próximo: Fase 11 — Promociones

`promotions`/`promotion_rules`/`promotion_redemptions` sobre los `customers`
(Fase 9) y `loyalty_tiers` (Fase 10) de las dos fases anteriores — el primer
consumidor real de `CUSTOMER_TIER` como condición de una regla.
