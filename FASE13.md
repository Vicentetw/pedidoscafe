# Fase 13 — Hardware (buzzers) · estado

Última fase del roadmap original (`ARQUITECTURA_V1.md` §4.9, `prompt.txt`
§22-23). Sigue "modo mostrador": pedís, pagás, recibís un aviso (físico y/o
digital), retirás. Verificada contra la misma MySQL 8 (Docker) + Firebase real.

## Qué quedó hecho

### Base de datos — `migrations/0014_hardware.sql`
- `devices` — buzzers/impresoras/pantallas por sucursal (`UNIQUE(tenant_id,
  branch_id, code)`).
- `device_assignments` — qué buzzer tiene cada pedido, con su liberación.
- `notifications` — log de avisos (a quién, por qué canal, si salió o no).
- **Permiso nuevo** (a diferencia de F9-F12, que reusaron catálogo existente):
  `devices:view/manage/assign` no estaba anticipado en ningún permiso previo
  — se agregó igual que `tables:manage` (F3) o `cash:manage` (F7). `view`+
  `assign` para encargado/cajero (entregan el buzzer al cobrar); `manage`
  (dar de alta hardware nuevo) sólo para dueño/admin.

### Backend
- **prompt.txt §23 es explícito: "no eliminar el dispositivo físico"** — se
  construyeron los DOS mecanismos, sin que uno reemplace al otro:
  - **Digital**: 100% funcional. `GET /api/public/orders/:publicId/status`
    + `GET /api/public/orders/:publicId/stream` (SSE) — sin login, el
    `public_id` (ULID) del pedido ES la credencial, mismo criterio que un
    token de QR. Se dispara automáticamente al quedar `READY`.
  - **Físico**: `devices.service.assignDevice/releaseDevice` (modo
    mostrador: se entrega el buzzer al cobrar, se libera al devolverlo) es
    real y probado. **El `page()` en sí — la señal de radio al buzzer — es
    un seam honesto** (`providers/buzzerRadio.provider.js`): no hay una base
    RF/RS-232 ni una cuenta cloud de ningún fabricante conectada a este
    entorno, así que tira `BUZZER_NOT_CONFIGURED` en vez de fingir que
    vibró. El intento (éxito o `FAILED`) queda igual en `notifications`.
  - Ninguno bloquea al otro: si el buzzer no está configurado, el aviso
    digital sale igual — y viceversa, un pedido sin buzzer asignado también
    tiene su link de seguimiento.
- **Enganche con cocina**: `kitchen.service.advanceTicket` llama a
  `devicesService.notifyOrderReady` sólo en la transición REAL a `READY`
  (no en cada avance de ticket — un pedido con dos estaciones no debe avisar
  dos veces, ni un ticket que ya estaba en `READY` y avanza a `DELIVERED`
  debe volver a avisar). Se ejecuta DESPUÉS de que la transacción de cocina
  confirma (lee con su propia conexión: adentro de la transacción todavía no
  vería el status nuevo). Nunca tira — un problema acá no puede frenar el
  flujo de cocina.
- Integración sin ciclos de `require`, mismo patrón que F10/F11: `orders`
  y `kitchen` importan `devices.service`; `devices.service` sólo importa
  `orders.repository` (nunca `orders.service`/`kitchen.service`).

### Frontend
- `admin/devices-page.ts` (`/admin/dispositivos`) — alta y pausa de buzzers.
- `staff/order-entry.ts` (mostrador) — entregar/liberar un buzzer al cobrar.
- `client/order-tracking.ts` (`/pedido/:publicId`, público) — página de
  seguimiento sin login: "Preparando… / ¡Listo para retirar!", con el código
  del buzzer si corresponde, actualizada en vivo por SSE.

## Verificado

- `npm run migrate` — `0014_hardware.sql` aplica limpio (3 tablas + permiso
  nuevo sembrado).
- **`npm test` → 237 pass, 0 fail, 0 skip.** 14 tests nuevos en la Fase 13:
  - **`devices-flow.test.js`** (9) — alta y listado; asignar dos veces el
    mismo código es idempotente; un pedido no puede tener dos dispositivos a
    la vez; un dispositivo ya asignado a otro pedido no se puede volver a
    entregar; código inexistente da 404; liberar deja el dispositivo
    disponible; **al llegar a READY con buzzer asignado: aviso digital
    `SENT` + intento de buzzer `FAILED`** (documentado, no fingido); un
    pedido sin buzzer también recibe el aviso digital; avanzar el ticket una
    tercera vez (READY→DELIVERED) NO vuelve a avisar.
  - **`devices-isolation.test.js`** (2) — el mismo código de buzzer en dos
    empresas no choca; asignar el de A nunca toca el de B.
  - **`devices-admin.test.js`** (3, HTTP con token real) — mozo no ve
    dispositivos; cajero puede asignar pero no registrar hardware nuevo
    (`devices:assign` vs `devices:manage`); el seguimiento público del
    pedido no pide login (y un `publicId` inventado da 404).
- Se re-corrió además `orders`/`kitchen`/`stock`/`payments`/`fiscal`/`crm`/
  `loyalty`/`promotions`/`analytics` (78 tests) por tocar
  `orders.repository`, `orders.routes.js` y `kitchen.service.js` — sin
  regresiones.
- `ng build --configuration production` OK con `devices-page`,
  `order-entry` (campo de buzzer) y `order-tracking` (página pública) nuevos.
- **Bug real que agarró el test suite en la primera pasada**: mi primer
  intento de disparar el aviso sólo miraba `orderStatus === 'READY'` en el
  resultado de `advanceTicket` — pero esa variable queda en `'READY'`
  también cuando el pedido YA estaba en `READY` y otro ticket del mismo
  pedido avanza sin cambiar el status del pedido (por ejemplo, camino a
  `DELIVERED`). Corregido con un flag `justBecameReady` que sólo es `true`
  en la transición real, no cada vez que el pedido "está" en `READY`.

## Cierre del roadmap original (Fases 1-13)

Con esta fase se completan las 13 fases planteadas en `ARQUITECTURA_V1.md`.
Los 8 casos obligatorios de `prompt.txt` §58 están cubiertos desde la Fase 6.
`npm test` = **237 pass / 0 fail / 0 skip** de punta a punta. Lo que queda
deliberadamente afuera (AFIP real, BOGO/COMBO/FREE_ITEM, segmentos de CRM,
Food Cost/Margin, radio real de buzzers) está documentado caso por caso en su
FASE{N}.md correspondiente, no silenciado.

Corresponde ahora lo que el usuario pidió para el final: pruebas de
aceptación juntos.
