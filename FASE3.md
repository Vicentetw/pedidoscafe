# Fase 3 — Mesas, QR y sesiones de mesa · estado

Sigue `ARQUITECTURA_V1.md` §4.5 (ERD), §7 (máquina de estados de TableSession),
§8 (guest mode), §12 (concurrencia), §15–26 (seguridad del QR). Construida y
verificada contra la misma MySQL 8 (Docker) + Firebase real de las fases anteriores.

## Qué quedó hecho

### Base de datos — `migrations/0004_tables.sql`
- `tables` — mesa física (`code` único por `(tenant_id, branch_id)`), `status`,
  `current_session_id`.
- `qr_tokens` — **token opaco** (`base64url` de 32 bytes aleatorios), `status`
  `ACTIVE|ROTATED|REVOKED`. El QR impreso es sólo `…/t/<token>`; no lleva nada de
  negocio.
- `table_sessions` — `public_id` ULID, máquina de estados (`OPEN…CLOSED` + `ABANDONED`
  / `FORCE_CLOSED`), `order_mode` `INDIVIDUAL|GROUP`, `total_amount` / `paid_amount`.
  **Índice único parcial emulado**: columna generada `active_table_id` = `table_id`
  sólo mientras la sesión está viva → `UNIQUE` garantiza **una sola sesión activa por
  mesa**.
- `session_participants` — `public_id` ULID, `display_name` / `nickname` / `seat_no`,
  `kind` `GUEST|REGISTERED` (guest mode: nunca obliga a registrarse).
- Permiso nuevo **`tables:manage`** (mesas + QR), sembrado en `owner`, `admin_general`,
  `admin_sucursal`, `encargado`.

### Backend — módulo `tables`
- **`tableSession.stateMachine.js`** — transiciones permitidas + `assertTransition`
  (tira `DomainError` 409 `INVALID_SESSION_TRANSITION`).
- **`tables.repository.js`** — CRUD de mesas / QR / sesiones / participantes.
  `lockTableRow()` hace `SELECT … FOR UPDATE` sobre la fila de la mesa: **serializa
  los escaneos concurrentes del mismo QR** (§8/§12).
- **`tables.service.js`**:
  - Staff: crear mesa (auto-genera QR), rotar/revocar QR, abrir sesión desde el salón,
    listar mesas abiertas, asignar mozo, **cerrar** (sólo si `paid == total`) y
    **cierre forzado** (`tables:force_close`, con motivo, auditado). Cada cambio emite
    evento al outbox + SSE `tables` + `audit_log`.
  - Comensal: `resolveQr(token)` valida ACTIVE + tenant/branch/tabla server-side y
    responde **un único mensaje** ante cualquier falla (no filtra qué parte estaba
    mal, §26). `startSession(token, …)` crea **o recupera** la sesión de esa mesa,
    suma participante y emite el **`table_session_token`** (JWT con `tid/bid/tbl/sid/pid`).
    `getGuestSession` / `addGuestParticipant` / `setOrderMode` operan siempre sobre la
    sesión del token, nunca sobre lo que venga en el body.
- **Rutas**:
  - `/api/tables/*` — staff, `tables:view` / `tables:manage` / `tables:open_session` /
    `tables:assign_waiter` / `tables:force_close`.
  - `/api/public/qr/:token/resolve` y `/api/public/table-sessions` — **sin login**
    (bajo `/api/public`), con firewall por país (geoip-lite) + Turnstile opcional.
  - `/api/session/*` — comensal, **gateado por el `table_session_token`** (no Firebase),
    incluye `GET /api/session/stream` (SSE de la sesión, con `?access_token=` porque
    EventSource no manda headers).

### Frontend
- `client/table-session.ts` (`/t/:token`) — resuelve el QR, el comensal pone su
  nombre y se une, ve quiénes están en la mesa y el modo de pedido; se actualiza en
  vivo por SSE. El JWT se guarda en `sessionStorage` para sobrevivir un refresh.
- `core/table-session.ts` — servicio con el estado de la sesión del comensal.
- `admin/tables-page.ts` (`/admin/mesas`) — mesas por sucursal, alta, ver/copiar/rotar
  el link del QR, mesas abiertas y cierre (normal / forzado).

## Verificado

- `npm run migrate` — `0004_tables.sql` aplica limpio (4 tablas nuevas + permiso).
- **`npm test` → 79 pass, 0 fail, 0 skip.** Nuevo en la Fase 3 (30 tests):
  - **`tableSession-state.test.js`** (5) — transiciones válidas / prohibidas / `from===to`.
  - **`tables-qr.test.js`** (6) — resolver el QR (sin nada sensible; token inexistente
    y **rotado dan el mismo 404**); `POST /table-sessions` crea sesión + participante +
    JWT con scope correcto; **un 2º escaneo recupera la misma sesión** (base del caso 6);
    **dos escaneos SIMULTÁNEOS → 1 sesión, 2 participantes, 2 JWT** (lock pesimista);
    el body no puede inyectar `tenant/branch/table/price`.
  - **`session-guest.test.js`** (6) — sin token → 401; la sesión propia con `isYou`;
    sumar participante; cambiar a `GROUP`; un JWT sólo opera sobre su sesión; JWT con
    secreto falso → 401, JWT huérfano → 404.
  - **`tables-isolation.test.js`** (6) — dos empresas con mesa de igual código: A nunca
    resuelve/lista nada de B; el QR resuelve siempre a su propio tenant.
  - **`tables-admin.test.js`** (7, HTTP con token real) — encargado crea mesa + QR;
    `mozo` no puede crear mesas (403); rotar el QR (el viejo deja de resolver);
    2º intento de abrir sesión → 409; `mozo` abre sesión pero no fuerza el cierre;
    cierre forzado → `FORCE_CLOSED`, mesa libre, auditado con motivo.
- `ng build` (dev y prod) OK con `table-session` y `tables-page`.

## Caso obligatorio 6

> Dos personas piden desde la misma mesa → dos pedidos asociados a una misma
> TableSession.

La **base** está cubierta: dos escaneos del mismo QR (incluso simultáneos) quedan en
**una sola** `table_session` con **dos** `session_participants` y dos JWT
independientes. Los pedidos individuales por participante se agregan en la Fase 4.

## Próximo: Fase 4 — Pedidos

`orders` + `order_items` + `order_item_modifiers` (snapshot de precio), máquina de
estados de `Order`, `order_events`, KDS (`kitchen_stations`, ruteo, `kitchen_tickets`),
prioridad, timestamps. El "aviso de que otra persona está pidiendo" (§9) se completa
acá con los borradores de pedido.
