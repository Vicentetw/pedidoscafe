# Mapa del proyecto

Monorepo (~17.800 líneas propias). SaaS multiempresa para cafés/restaurantes.

| Carpeta | Qué hay |
|---|---|
| `backend/server.js` | Arranque: chequea DB, Firebase Admin, app, workers (outbox 1 s, reservas vencidas 60 s) |
| `backend/src/app.js` | Orden de middlewares (webhook raw → json → log → /health → seguridad → /api → errores) |
| `backend/src/routerRegistry.js` | Monta los 14 módulos bajo `/api` |
| `backend/src/modules/<m>/` | `*.routes.js` → `*.service.js` → `*.repository.js` (+ `*.schema.js` zod) |
| `backend/src/{auth,http,events,audit,jobs}` | Identidad, seguridad/SSE/errores, outbox, auditoría, jobs |
| `backend/migrations/` | 15 SQL + `run-sql.js` (checksum; nunca editar una aplicada) |
| `backend/test/` | `node --test`, 51 archivos |
| `shared/permissions.js` | Catálogo único de permisos `modulo:accion` |
| `frontend/src/app/` | Angular 20: `core/` (auth, interceptor, guards, shell), `features/{client,staff,admin,platform,shared}` |
| `frontend/android/` | Capacitor (APK) |
| Raíz | `render.yaml`, `firebase.json`, `DEPLOY.md`, `ARQUITECTURA_V1.md` (diseño original), `FASE*.md` (actas históricas, no estado actual) |

## Comandos
- `npm run install:all`, `npm run dev`
- `npm --prefix backend run migrate` / `migrate:status`
- `npm --prefix backend test` (ver `TESTING_STRATEGY.md` antes)
- `npm --prefix frontend run build`, `npm --prefix frontend run android:apk`

## Deploy
Render (backend, autodeploy de `main`, pool 3) · Firebase Hosting (frontend, manual) · Clever Cloud MySQL (plan free, 10 MB).
