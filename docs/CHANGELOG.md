# Registro de cambios

Historial anterior: `git log` y `FASE*.md`.

## 2026-11-03 — falla 2 (sin commit)
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
