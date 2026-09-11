# pedidoscofee

Sistema operativo SaaS para cafés, bares y restaurantes. Monorepo único
(un repo, un deploy): `backend/` (Express + `mysql2`, sin ORM — Camino C),
`frontend/` (Angular, mobile-first) y `shared/` (contratos JS).

- Visión de producto: **`prompt.txt`**
- Reúso desde el sistema de asistencia + revisión del prompt: **`INSTRUCCIONES.md`**
- Arquitectura v1 (entregable de la Fase 0, validado): **`ARQUITECTURA_V1.md`**
- Estado de la Fase 1 (Foundation): **`FASE1.md`**

## Puesta en marcha (desarrollo)

Requisitos: Node ≥ 20, MySQL 8, un proyecto de Firebase (para el login del staff).

```bash
# 1. Dependencias
npm run install:all           # raíz + backend + frontend

# 2. Config
cp .env.example .env          # completar DB_*, API_KEY, FIREBASE_SERVICE_ACCOUNT_PATH, SESSION_TOKEN_SECRET
#   dejar backend/serviceAccountKey.json (service account de Firebase) — está en .gitignore

# 3. Base de datos
#   opción A — Docker (lo que se usó para verificar la Fase 1):
docker run -d --name pedidoscofee-mysql \
  -e MYSQL_ROOT_PASSWORD=rootpw -e MYSQL_DATABASE=pedidoscofee \
  -e MYSQL_USER=pedidoscofee -e MYSQL_PASSWORD=pedidoscofee \
  -p 3307:3306 mysql:8.0 \
  --character-set-server=utf8mb4 --collation-server=utf8mb4_0900_ai_ci
#   (el .env.example ya viene con DB_PORT=3307 para este contenedor)
#   opción B — MySQL propia:
#   CREATE DATABASE pedidoscofee CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

npm run migrate               # aplica backend/migrations/*.sql (idempotente, registra en schema_migrations)
npm run migrate -- --status   # ver qué está aplicado / pendiente

# 4. Datos mínimos de desarrollo
node backend/seeds/dev-seed.js --superadmin-uid <firebase_uid> --superadmin-email vos@ejemplo.com
node backend/seeds/dev-seed.js --tenant "Café Demo" --branch "Centro" \
     --owner-uid <otro_uid> --owner-email dueno@demo.test

# 5. Correr
npm run dev                   # backend (:3001) + frontend (:4200) en paralelo
```

Completar `frontend/src/environments/environment.development.ts` con el
`firebaseConfig` del proyecto (el `apiKey` de Firebase es público) y, si
configuraste `API_KEY` en el backend, el mismo valor en `apiKey`.

## Tests

```bash
npm test    # = backend: node --test --test-concurrency=1
```

- Los tests **unitarios / de humo** corren sin base (`health.test.js`).
- Los de **integración** (`full-tenant-isolation.test.js`, `rbac-enforcement.test.js`)
  se **saltan** salvo que el `.env` tenga `DB_*` + `FIREBASE_SERVICE_ACCOUNT*` +
  `FIREBASE_WEB_API_KEY`. Con esas variables y la base migrada, corren de verdad.
  Usan empresas descartables (ids 99993x/99994x), nunca datos reales.

## Estructura

```
backend/
  server.js                  arranque (webhook raw → json → security → /api → errorHandler)
  src/
    config.js db.js withTransaction.js logger.js errors.js
    http/     security · errorHandler · sse · asyncHandler
    auth/     firebase · appUserMiddleware (resolveTenantId, requirePermission) · sessionToken (JWT comensal)
    events/   bus (in-process) · outbox (tabla domain_events)
    audit/    audit (writeAudit)
    repositories/  appUserRepository (permisos efectivos)
    modules/
      platform/   tenants · branches · users · roles · settings
      health/
    routerRegistry.js · app.js
  migrations/  run-sql.js + 0001_platform_identity.sql + 0002_seed_system_roles.sql
  seeds/       dev-seed.js
  test/        helpers/ + full-tenant-isolation + rbac-enforcement + health
frontend/
  src/app/
    core/     auth · auth-interceptor · current-user · session-guard · permission-guard · api · shell · login · access-denied
    features/  client/ (comensal) · staff/ · admin/ · platform/
shared/
  permissions.js             catálogo canónico "modulo:accion"
```
