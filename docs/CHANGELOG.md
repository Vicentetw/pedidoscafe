# Registro de cambios

Historial anterior: `git log` y `FASE*.md`.

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
