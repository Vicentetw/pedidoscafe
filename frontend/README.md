# frontend/

Angular (standalone components, signals, zoneless, lazy loading). Tres
superficies bajo el mismo proyecto (ARQUITECTURA_V1 §16):

| Ruta raíz | Superficie | Login |
|---|---|---|
| `/t/:token` | Comensal (mobile-first extremo) | no |
| `/staff` | Mozo · cocina · caja | Firebase |
| `/admin` | Back-office + plataforma | Firebase |

## Estado (Fase 1)

Andamiaje portado del sistema de asistencia y adaptado:

- `core/auth.ts` — Firebase (email + Google), con `authStateReady()` y recarga
  completa en login/logout (arreglos ganados a los golpes, no perderlos).
- `core/auth-interceptor.ts` — `x-api-key` + Bearer a cada request al backend.
- `core/current-user.ts` — `GET /api/platform/users/me`, reintentos ante cold-start,
  set de permisos resuelto. Sin lógica de billing (eso es la Fase 6b).
- `core/session-guard.ts` / `core/permission-guard.ts` — `{ permission: 'modulo:accion' }`
  y `{ superadminOnly: true }` en las rutas.
- `core/shell/` — sidebar mínimo por superficie, nav filtrada por permiso.
- `features/admin/branches-page.ts`, `features/platform/tenants-page.ts` — CRUD real
  contra la API (prueban el circuito completo).
- `features/admin/users-page.ts` / `settings-page.ts` — lectura.
- `features/staff/*`, `features/client/*` — placeholders hasta las Fases 3–4.

Pendiente de traer del sistema de asistencia (fases siguientes): shell oscuro
Material 3, `styles.css` unificado, `shared/` (info-hint, sync-status-banner,
export CSV/PDF), pantallas de plataforma completas.

## Correr

```bash
npm install
npm start        # ng serve en :4200  (proxy manual: el interceptor apunta a environment.backendUrl)
```

Completar `src/environments/environment.development.ts` con el `firebaseConfig`.
