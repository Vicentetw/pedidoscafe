# Registro de cambios

Historial anterior: `git log` y `FASE*.md`.

## 2026-11-10 — falla 8, parte 1: base de 10 MB y conexiones (publicado)
Medido: el esquema vacío ocupa 4,23 MB y ~900 pedidos llenan los 10 MB (~6 KB por pedido); `domain_events` era la tabla más grande y nadie la lee.
- `events/outbox.js` `purgeDispatched`: borra eventos ya despachados con más de 7 días, de a lotes; nunca los no despachados.
- `jobs/purgeDomainEvents.js`: la corre 1 min después de arrancar y cada 6 h (Render puede dormir el servicio).
- `server.js`: el despacho del outbox pasa de cada 1 s a cada 10 s (sin consumidores; libera la conexión).
- `inventory.service.js` `adjustStock`: la auditoría usa la conexión de la transacción. Antes pedía una 2ª conexión: con 3 ajustes simultáneos (límite 3) el backend se colgaba. Encontrado corriendo la suite con `DB_CONNECTION_LIMIT=1`: fue el único caso.
- Test nuevo `domain-events-purge.test.js` (tenant 998925, 2 tests). Suite 315/315. Sin migraciones. Sin cambios de frontend.

## 2026-11-08 — falla 7 (publicado)
Reportes de ventas.
- `payments.service.js`: un pago SPLIT (montos sueltos, "partes iguales" o MP) que deja la mesa saldada marca todos sus pedidos como pagados (`markOrdersIfSessionSettled`). Antes esas ventas no aparecían en ningún reporte. Un SPLIT parcial sigue sin atribuirse a pedidos.
- `analytics.repository.js`: venta = pagado y no cancelado (resumen, clientes repetidos, ranking y series diarias).
- `payments-page.ts`: si Conciliación falla, la tarjeta muestra el error en vez de desaparecer (7b).
- Test nuevo `analytics-sales-accuracy.test.js` (tenant 998945, 3 tests). Suite 313/313. Frontend compila. Sin migraciones.
- Datos existentes: los pedidos de mesas ya cobradas con SPLIT siguen UNPAID y `daily_sales_rollup` guarda lo ya calculado; recalcular el rollup tras el deploy.

## 2026-11-07 — falla 6 (publicado)
Sin stock respondía HTTP 200 con `{ error, code }`; Angular lo tomaba como éxito (el comensal veía el pedido como confirmado; la pantalla del mozo quedaba rota).
- `orders.service.js`: `ITEM_UNAVAILABLE` (confirmar, agregar y subir cantidad) pasa de status 200 a 409. Mismo mensaje humano, mismo `code` y `details`.
- `session-order-detail.ts`: "Enviar todos a cocina" ahora muestra los pedidos que no se enviaron y por qué (antes los callaba).
- Test nuevo `stock-http-status.test.js` (HTTP, tenant 998975, 2 tests); `stock-menu.test.js` y `stock-reservation.test.js` ajustados de 200 a 409. Suite 310/310. Frontend compila. Sin migraciones.

## 2026-11-06 — falla 5 sin devoluciones + 7b (publicado)
Devoluciones congeladas por el dueño: nada de esto mueve dinero.
- `orders.service.js` `cancelOrder`: pedido ya cobrado → motivo obligatorio (422 sin motivo), el comensal no puede (403), auditoría `cancel_paid`.
- `payments.service.js` `getReconciliation`: nueva lista `cancelledPaidOrders`.
- `updateItem` en pedido confirmado: ajusta el stock simple por la diferencia (sin stock → `ITEM_UNAVAILABLE`), actualiza la cantidad en el ticket de cocina, evento `OrderAmended`.
- Auditoría `amend_add` / `amend_qty` / `amend_remove` en pedidos confirmados.
- Frontend: aviso y motivo obligatorio al cancelar un pedido cobrado; línea nueva en Conciliación.
- 7b: `payments.routes.js` declara `/reconciliation` antes de `/:id` (respondía 500); test `payments-reconciliation-route.test.js`.
- 8 tests nuevos (`order-amend-cancel.test.js` y el de 7b). Suite 308/308. Frontend compila. Sin migraciones.
- `mp-webhook-transitions.test.js` pasa al tenant 998935 (998930 estaba repetido).

## 2026-11-06 — falla 4 (publicado)
Efectivo y caja. Decisión del dueño: sin caja abierta no se cobra en efectivo (como los POS de restaurante).
- `cash.service.js` `resolveSessionForCashPayment`: sin caja abierta en la sucursal → 409 `CASH_SESSION_REQUIRED`; sin `cashSessionId` usa la única abierta; varias → 409 `CASH_SESSION_AMBIGUOUS`; caja de otra sucursal → 422.
- `payments.service.js`: `chargeSession` (CASH), `splitEqual` y `chargeOrder` (CASH) la usan; toda venta en efectivo queda como movimiento SALE de esa caja.
- `payments-page.ts`: ayuda "¿Cómo se cobra?", aviso si no hay caja (con link a Cajas si tiene `cash:open`), selector si hay varias, manda `cashSessionId`.
- 4 tests nuevos (`cash-required.test.js`); `helpers/cash.js` abre una caja en 9 archivos de test que cobran en efectivo. Suite 300/300. Frontend compila. Sin migraciones.
- MercadoPago no pasa por la caja (sin cambios).

## 2026-11-05 — falla 3 (publicado)
Webhook y "Verificar pago" de MercadoPago.
- `payments.service.js` `processMpWebhookNotification`: re-consulta a MP fuera de la transacción; clave de idempotencia `topic:data.id:estado` (antes se perdía in_process→approved); bloquea y relee el pago antes de aplicar (antes podía acreditar dos veces junto a "Verificar pago").
- `checkPendingMpPayment`: consulta a MP fuera de la transacción; adentro bloquea y revalida PENDING.
- `webhook.routes.js`: error transitorio → 500 (MP reintenta); antes 200 y se perdía. Avisos que no son de pagos (`merchant_order`) y pagos que MP no conoce (404) siguen en 200.
- `mercadopago.provider.js`: el error de re-consulta incluye el código HTTP de MP.
- 5 tests nuevos (`mp-webhook-transitions.test.js`); `payments-webhook.test.js` ajustado al nuevo formato de clave. Suite 295/295. Sin migraciones.
- Queda para la falla 5: la devolución sigue llamando a MP dentro de la transacción.

## 2026-11-03 — `7be7f81` falla 2 (publicado)
Aislamiento multiempresa al crear pedidos.
- `orders.service.js` `createOrder`: 422 si la sucursal, la mesa o el cliente no son de la empresa, o si la mesa es de otra sucursal.
- `orders.repository.js` `recomputeSessionTotal`: sólo suma pedidos de la empresa de la mesa.
- 7 tests nuevos (`orders-tenant-refs.test.js`). Suite 290/290. Sin migraciones.

## 2026-11-03
- Documentación de continuidad en `docs/` + `CLAUDE.md`. Sin cambios de código.
- Auditoría de solo lectura completa; hallazgos en `KNOWN_ISSUES.md`.

## 2026-10-30 — `74e1513` (publicado)
Falla 1: pedidos con mesa cerrada o participante quitado.
- `sessionToken.js`: el middleware revalida contra la DB; participante quitado → 401; mesa terminal → 409 `SESSION_CLOSED` en escrituras.
- `orders.service.js`: crear/editar/enviar rechaza mesas terminales, con lock sesión → pedido.
- `tables.service.js`: `closeSession` valida saldo con la fila bloqueada.
- `tables.repository.js`: `findGuestAccess`.
- 14 tests nuevos (`session-closed-guard.test.js`). Sin migraciones.
- Decisión: staff puede seguir cancelando en mesa cerrada.

## 2026-10-30 — auditoría
8 bloqueos reproducidos sobre `f78c321`. Incidente: la corrida de tests usó el `.env` real y creó/borró usuarios temporales en Firebase de producción.
