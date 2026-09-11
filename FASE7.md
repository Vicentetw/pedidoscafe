# Fase 7 — POS / Caja · estado

Sigue `ARQUITECTURA_V1.md` §35 (cajas) y el roadmap de la Fase 7 (apertura/cierre,
arqueo, conciliación). Verificada contra la misma MySQL 8 (Docker) + Firebase real.

## Qué quedó hecho

### Base de datos — `migrations/0008_cash.sql`
- `cash_registers` — cajas físicas por sucursal.
- `cash_sessions` — apertura/cierre/arqueo. **Una sola sesión `OPEN` por caja**,
  misma técnica que `table_sessions` (columna generada `active_register_id` +
  `UNIQUE`).
- `cash_movements` — ledger: `SALE | REFUND | PAYOUT | DEPOSIT | ADJUST`, con signo.
- `payments` gana `cash_session_id` (nullable) — **vínculo opcional**: cobrar en
  efectivo sin haber abierto una caja sigue funcionando igual que en la Fase 6 (no
  rompe nada de lo anterior); si se indica una caja abierta, además queda el
  movimiento y la trazabilidad.
- Permiso nuevo `cash:manage` (alta de cajas físicas — configuración, no un
  movimiento), sembrado en `owner`/`admin_general`/`admin_sucursal`/`encargado`
  (mismo criterio que `tables:manage`, Fase 3).

### Backend — módulo `cash`
- `openRegister` — no dos sesiones abiertas sobre la misma caja.
- `addMovement` — `PAYOUT`/`DEPOSIT` siempre restan/suman con el signo que decide el
  sistema (no quien carga el movimiento); `ADJUST` sí permite ambos signos.
- `closeRegisterSession` — `esperado = apertura + Σ movimientos`,
  `diferencia = contado - esperado`, deja el arqueo registrado tal cual (con
  diferencia si la hay, no la oculta).
- **`payments.service.js`** se conecta con `cash.service.js`: un cobro en efectivo
  con `cashSessionId` dentro del body deja un movimiento `SALE` en esa caja (y una
  devolución sobre ese pago, un `REFUND` — **sólo si la caja sigue abierta**; una
  caja ya cerrada no se vuelve a tocar sola).
- **`GET /api/payments/reconciliation`** — conciliación construida desde el propio
  ledger (ver nota abajo): pagos `PENDING` viejos sin resolver, pedidos de
  mostrador entregados sin cobrar, mesas cerradas por la fuerza con saldo
  pendiente, y devoluciones `PENDING` (los excedentes que la Fase 6 detecta
  cuando un pago se aprueba sobre una mesa ya saldada).

### Frontend
- `admin/cash-page.ts` (`/admin/cajas`) — alta de cajas, abrir/cerrar, movimientos
  manuales, arqueo.
- `admin/payments-page.ts` (`/admin/caja`) — ahora muestra un resumen de
  conciliación de la sucursal.

## Nota sobre la conciliación

`prompt.txt` §34 pide cruzar **venta registrada** vs. **pago confirmado** vs.
**dinero conciliado en MercadoPago**. Sin una cuenta real de MercadoPago en este
entorno (mismo motivo que en la Fase 6 — ver FASE6.md), no hay forma de traer el
reporte de liquidaciones real de MP para cruzarlo. Lo que se construyó acá detecta,
a partir de **nuestro propio ledger** (que ya es consistente por diseño: reservas,
webhooks idempotentes, `FOR UPDATE`), las categorías de discrepancia que el sistema
mismo puede ver. Cuando haya una cuenta de MercadoPago real, se suma un cron que
trae sus operaciones liquidadas y las cruza contra `payments`/`payment_transactions`
— la tabla `payment_transactions` ya guarda el historial con el proveedor,
preparada para eso.

## Verificado

- `npm run migrate` — `0008_cash.sql` aplica limpio (3 tablas + columna en `payments`).
- **`npm test` → 160 pass, 0 fail, 0 skip.** 14 tests nuevos en la Fase 7:
  - **`cash-flow.test.js`** — abrir una caja (un 2º intento sobre la misma → 409);
    un cobro en efectivo vinculado deja un movimiento `SALE`; un retiro manual resta
    del saldo; **cerrar calcula lo esperado y la diferencia del arqueo**; una
    devolución sobre una caja ya cerrada no le toca el ledger; un arqueo con
    diferencia (faltante) queda registrado tal cual.
  - **`payments-reconciliation.test.js`** — detecta cada una de las 4 categorías de
    discrepancia por separado, y que la ventana de "pago viejo" (`staleMinutes`)
    funciona.
  - **`cash-admin.test.js`** (HTTP, token real) — un `mozo` no ve ni crea cajas; un
    `cajero` puede abrir/cerrar pero **no** crear una caja nueva (`cash:manage`); el
    `encargado` sí.
- `ng build` (dev y prod) OK con `cash-page` y el resumen de conciliación en
  `payments-page`.
- **Bug real encontrado al verificar**: `closeRegisterSession` calculaba el monto
  esperado pasando la suma de movimientos por `fromCents()` dos veces — el arqueo
  daba una diferencia falsa (dividía por 100 de más). Corregido y cubierto por el
  test de cierre.
- **Otro hallazgo del propio proceso de testing**: dos IDs de tenant de prueba
  quedaron repetidos entre archivos de fases distintas (ej. `payments-admin.test.js`
  y `rbac-enforcement.test.js` usaban el mismo `999940`) — rompía el `before()` del
  que corría segundo. Reasignados a un bloque propio (`998900-998999` para pagos/
  caja) y documentado el criterio en `test/helpers/db.js` para no repetirlo.

## Próximo: Fase 8 — Fiscal AFIP/ARCA

Módulo grande y 100% nuevo (certificado digital, WSAA, WSFEv1, homologación antes
de producción, CAE, tipos A/B/C). El sistema sigue emitiendo **ticket no fiscal**
hasta que esa fase esté lista — no bloquea nada de lo construido hasta acá.
