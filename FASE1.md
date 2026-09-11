# Fase 1 — Foundation · estado

Base del proyecto según `ARQUITECTURA_V1.md` §20 (roadmap) y §17 (backend Camino C).

## Qué quedó hecho

### Monorepo
- Un repo, un deploy. `backend/` + `frontend/` + `shared/`, `package.json` raíz con
  scripts (`dev`, `migrate`, `seed`, `test`, `install:all`).
- `.gitignore` con secretos fuera (`.env`, `serviceAccountKey.json`).
- `.env.example` en la raíz — lo leen backend y migraciones.

### Backend (Express estructurado, sin ORM)
- **Infra**: `config.js` (env + `assertDbConfig`), `db.js` (**pool único** `mysql2`,
  `namedPlaceholders`), `withTransaction.js`, `logger.js` (JSON + `request_id`),
  `errors.js` (`DomainError` y familia).
- **HTTP**: `security.js` (helmet · rate-limit · CORS · API key · `publicPaths`) —
  portado de asistencia, **con el bug de CORS corregido** (el delegate mal usado que
  terminaba permitiendo todo origen). `errorHandler.js` traduce `ZodError` /
  `DomainError` / choques de FK a JSON con forma estable y **lenguaje humano** (nunca
  un 409 crudo ni un stack). `sse.js` (hub Server-Sent Events por tenant/branch/topic).
- **Auth**: `firebase.js` (verificación de ID token, fallback permisivo sin
  credenciales), `appUserMiddleware.js` (`resolveTenantId`, `requireTenantId`,
  `requirePermission`, `requireSuperadmin`, `tenantFilter`), `sessionToken.js`
  (emitir/verificar el `table_session_token` JWT del comensal — listo para la Fase 3).
- **Eventos**: `bus.js` (EventEmitter in-process) + `outbox.js` (tabla `domain_events`,
  `enqueue` transaccional + worker de despacho).
- **Auditoría**: `audit.js` (`writeAudit`, nunca hace fallar la operación que lo llama).
- **Permisos efectivos**: `repositories/appUserRepository.js` — roles (`user_roles` →
  `role_permissions`) UNION overrides `user_permissions` ALLOW, menos los DENY.
- **Módulo `platform`**: `tenants` (superadmin), `branches`, `users` (+ `/me`,
  invitación vía Firebase Admin), `roles` (presets de sistema + roles propios de la
  empresa + catálogo de permisos), `settings` (config por negocio, claves conocidas
  validadas). Todos con capas `repository` / `schema` (zod) / `service` / `routes`.
- **Módulo `health`**: `/health` y `/health/db` públicos.
- `app.js` (arma la app, orden de montaje del §17 con hook para el webhook raw de MP)
  + `server.js` (boot, chequeo de DB, worker de outbox, shutdown ordenado).

### Base de datos
- `migrations/run-sql.js` — runner idempotente con tabla `schema_migrations`
  (nombre + checksum + fecha); aborta si una migración ya aplicada cambió de contenido.
  `--status` lista pendientes/aplicadas.
- `0001_platform_identity.sql` — `tenants`, `app_users`, `branches`, `roles`,
  `role_permissions`, `user_roles`, `user_permissions`, `audit_log`, `domain_events`,
  `settings`. Convenciones del §18: InnoDB/utf8mb4, PK `BIGINT UNSIGNED`, FKs reales,
  **toda clave natural `UNIQUE (tenant_id[, branch_scope], code)` — nunca global**,
  `branch_scope = COALESCE(branch_id, 0)` para el "valor a nivel empresa".
- `0002_seed_system_roles.sql` — los **14 roles preset** (`prompt.txt` §4) con sus
  permisos, idempotente.
- `seeds/dev-seed.js` — superadmin + empresa + sucursal + dueño para desarrollo.

### Tests
- `test/helpers/` — `firebaseTestAuth.js` (ID token real + alta en `app_users`,
  portado de asistencia), `server.js` (app en puerto efímero), `env.js` (detecta si
  hay entorno de integración).
- `test/health.test.js` — humo, **corre siempre**. ✔ 3/3.
- `test/full-tenant-isolation.test.js` — **la red de seguridad de aislamiento**
  (INSTRUCCIONES §2): dos empresas con sucursal de igual código, misma clave de
  config, mismo nombre de rol; verifica que A nunca ve nada de B en branches (lista +
  por id + editar), settings, roles y users. Se salta sin `.env` de integración.
- `test/rbac-enforcement.test.js` — un `mozo` no puede listar roles ni crear
  sucursales (403); `/users/me` devuelve el set correcto; un DENY individual pisa el
  permiso del rol.

### Frontend (Angular, andamiaje)
- `core/`: `auth.ts` (con `authStateReady()` + recarga limpia), `auth-interceptor.ts`,
  `current-user.ts` (adaptado a `/api/platform/users/me`, sin billing),
  `session-guard.ts`, `permission-guard.ts` (`{ permission }` / `{ superadminOnly }`),
  `api.ts`, `shell/` (sidebar por superficie), `login/`, `access-denied/`.
- `features/`: `admin/` (inicio, **sucursales** y **empresas** con CRUD real contra la
  API; usuarios y configuración de lectura), `staff/` y `client/` como placeholders.
- Rutas: `/t/:token` (comensal, público), `/staff/*`, `/admin/*`.

## Verificado (contra MySQL 8 real, en Docker)

Contenedor `pedidoscofee-mysql` (MySQL 8.0.46, puerto 3307). `.env` de la raíz
apunta ahí.

- `npm --prefix backend install` OK.
- **Migraciones aplican limpias** (`npm run migrate`): 11 tablas + `schema_migrations`,
  todas las claves únicas son compuestas `(tenant_id, ...)` — ninguna global; los
  14 roles preset sembrados con sus permisos (owner 43, admin_general 42, mozo 8, …).
- **`dev-seed.js` corre**: superadmin + empresa "Café Demo" (slug `cafe-demo`, acento
  bien normalizado) + sucursal + dueño con rol `owner`.
- **El server arranca y conecta**: `db_ok`, outbox worker levantado, `http_listening`.
  `/health` → 200, `/health/db` → 200 (query real), `/api/platform/*` sin auth → 401
  `{ error, code }`.
- **`npm test` → 26 pass, 0 fail, 0 skip.** Con Firebase configurado (proyecto
  `restiapedidos`) corre TODO:
  - `tenant-isolation-repo.test.js` — 8 casos de aislamiento a nivel repositorio.
  - `full-tenant-isolation.test.js` — 6 casos por HTTP con **ID token real de Firebase**
    + permisos reales: la empresa A nunca ve branches / settings / roles / usuarios de
    la B (mismo código de sucursal, misma clave de config, mismo nombre de rol).
  - `rbac-enforcement.test.js` — 5 casos: un `mozo` no puede listar roles ni crear
    sucursales (403); `/users/me` devuelve el set correcto; un DENY individual pisa el
    permiso del rol.
  - `health.test.js` — 4 casos.
- **Frontend**: `npm --prefix frontend install` OK; `ng build` (dev y **producción**)
  compila sin errores ni warnings — **363 kB iniciales** en prod (budget 1.2 MB),
  todos los lazy chunks generados.

### Bugs encontrados y corregidos durante la verificación

1. **CORS** — el delegate portado de asistencia estaba mal usado (`cors({ origin: fn })`
   invoca `fn(origin, cb)`, no `fn(req, cb)`): `req.headers` era `undefined` y terminaba
   **permitiendo cualquier origen**. Reescrito como `corsOriginCheck(origin, cb)`.
2. **`settings.repository.js`** — volvía a hacer `JSON.parse` sobre un valor que mysql2
   ya devuelve parseado desde la columna JSON → `SyntaxError` al leer settings.
   `parse()` ahora es tolerante.
3. **`health.test.js`** — un test asumía 404 para `GET /api/ruta-inexistente` sin token.
   Con Firebase Admin configurado el gate de auth corre ANTES del router: eso es **401**
   (correcto, no se filtra qué rutas existen). Test ajustado; el 404 estable se prueba
   ahora sobre un path público (`/health/...`).

## Firebase (proyecto `restiapedidos`)

- Cuenta de servicio en `backend/serviceAccountKey.json` (gitignored). `.env` la apunta.
- App web `pedidoscofee-web` registrada; su `firebaseConfig` está en los dos
  `environment*.ts` del frontend y el `apiKey` en `FIREBASE_WEB_API_KEY` del `.env`.
- Authentication con **Correo/contraseña** habilitado.
- Superadmin real sembrado: `perrottavicente@gmail.com`
  (uid `hwOaBizsXZSmcZA7hepJkRYJFqI2`).

## Todavía NO verificado

- **El frontend contra el backend en vivo** — `firebaseConfig` ya está cargado; falta
  levantar `npm run dev` y probar el login + navegación de `/admin` a mano.

### La base de datos de desarrollo

El contenedor `pedidoscofee-mysql` queda levantado con el schema migrado y el seed de
"Café Demo". Para recrearlo desde cero:
`docker rm -f pedidoscofee-mysql` y volver a correr el `docker run` del README +
`npm run migrate`. Los `firebase_uid` del seed (`dev-super-uid`, `dev-owner-uid`) son
de mentira; re-sembrar con `--superadmin-uid <uid real de tu Firebase>`.

## Desvíos respecto de `ARQUITECTURA_V1.md` (menores)

- `plans` / `tenant_subscriptions` **no** se crean todavía (son de la Fase 6b; el
  puerto de `appUserMiddleware` quedó sin el gate de suscripción de asistencia, a
  propósito).
- El "controller" de las capas está **plegado dentro de `routes.js`** para el CRUD de
  plataforma (glue trivial). Los dominios complejos (ordering, payments, inventory)
  sí tendrán controller separado.
- `user_permissions` tiene columna `branch_scope` pero la resolución de permisos los
  trata como globales al tenant por ahora (acotar por sucursal es post-Fase-1).

## Próximo: Fase 2 — Menú

`menus`, `menu_categories`, `products` (+ `product_branch_overrides`),
`product_variants`, `modifier_groups` / `modifiers`, `product_tags`. Precio calculado
**siempre** en el backend. API pública de menú de sólo lectura. Cubre el caso
obligatorio 4 (el cliente intenta mandar un precio → se ignora).
