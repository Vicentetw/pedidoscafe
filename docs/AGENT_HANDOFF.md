# Handoff para el próximo agente

Última actualización: 2026-11-10 · falla 8 parte 1 publicada.

## Estado
- Producción arriba: backend `https://pedidoscafe.onrender.com`, frontend `restiapedidos.web.app`. El dueño aún no lo usa con clientes reales.
- Suite backend: 315 tests (59 archivos), 315/315 con Firebase simulado.
- Falla 2 y `docs/` publicados en `main`.
- Auditoría completa de solo lectura hecha el 2026-11-03; hallazgos en `KNOWN_ISSUES.md`.

## Plan de corrección (orden fijado por el dueño)
| # | Tema | Estado |
|---|---|---|
| 1 | Pedidos con mesa cerrada / participante quitado | Hecho y publicado (`74e1513`) |
| 2 | Aislamiento multiempresa en pedidos | Hecho y publicado (`7be7f81`) |
| 3 | Webhook y transiciones de MercadoPago | Hecho y publicado (refund de MP pasa a la 5) |
| 4 | Efectivo y movimientos de caja | Hecho y publicado (frontend: deploy manual a Firebase) |
| 5 | Cancelaciones, devoluciones y saldos. **Devoluciones congeladas por decisión del dueño (2026-11-06)**: no tocar `refundPayment` ni el refund de MP hasta que lo pida | Hecho y publicado sin devoluciones (+ ruta 7b) |
| 6 | Respuestas HTTP y falta de stock | Hecho y publicado (sin stock ahora es 409) |
| 7 | Analítica y conciliación | Hecho y publicado |
| 8 | Validaciones adicionales y seguridad | **En curso**. Parte 1 (purga, outbox 10 s, conexión anidada) hecha. Siguen: mesas y login configurables, seguridad del comensal, sesiones mezcladas, `/api/stream`, permisos/locks |

## Diseño aprobado 2026-11-10: mesas y login (falla 8, partes 2A y 2B)
Dueño: "todo con avisos y configurable sin romper nada". Todo por sucursal vía `settings` (con default si no hay fila).

**2A — Mesas** (job periódico + regla al escanear QR):
1. Sin consumo (ningún pedido confirmado, saldo 0) e inactiva `tables.idle_release_minutes` (60) → `ABANDONED`, mesa libre.
2. Pagada (saldo 0 con pedidos) e inactiva `tables.paid_autoclose_minutes` (30) → `CLOSED`.
3. Con saldo: NUNCA se cierra sola. Inactiva `tables.stale_hours` (3) → "mesa colgada": se ve en Mesas y en Conciliación; un QR nuevo NO entra a esa sesión ("pendiente de cierre, llamá al mozo").
4. `tables.day_close_hour` (4): a esa hora se aplican 1 y 2 sin esperar inactividad; las con saldo quedan marcadas.
Bug encontrado y NO corregido: el próximo cliente que escanea una mesa abierta entra a la sesión vieja (lo resuelve 2A.3).


### Estado de 2A al 2026-11-10 (rama `wip/mesas-autocierre`, NO está en `main`)
Código hecho, **tests escritos pero todavía sin correr** (Docker Desktop no arrancaba). Próximo paso: `bash backend/scripts/test-local.sh test/tables-housekeeping.test.js`, después la suite completa, corregir lo que falle, y recién ahí mergear a `main` con permiso del dueño.
- Backend: `tables/tables.housekeeping.js` (reglas puras + política por sucursal con `settingsRepo.getAll`), `tables.repository.js` (`listHousekeepingCandidates`, `housekeepingFacts`, `sessionIdleMinutes`, `idle_minutes` en `listOpenSessions`), `tables.service.js` (`autoFinishSession`, `runHousekeeping`, `reactivateSession`, `listStaleSessions`, `stale`/`idleMinutes` en mesas abiertas, `SESSION_STALE` en `startSession`), `jobs/tableHousekeeping.js` (cada 5 min, arrancado en `server.js`), ruta `POST /api/tables/sessions/:id/reactivate`, `staleSessions` en Conciliación, claves nuevas en `settings.routes.js`.
- Actividad = `GREATEST(table_sessions.last_activity_at, MAX(orders.updated_at))`, en minutos calculados en SQL (inmune a zona horaria). Hora de cierre en la zona de `branches.timezone`.
- Frontend: tarjeta "Mesas: cierre automático" en Configuración; marca "Cuenta colgada" + ayuda + botón "Sigue ocupada" en Mesas (staff y admin); línea en Conciliación. Compila.
- NO se tocó el aviso existente "mesa abierta hace mucho" (`orders.abandon_timeout_minutes`, por tiempo desde que se abrió): es otro contrato.
- Test: `test/tables-housekeeping.test.js` (tenant 998915, 6 tests).
- Herramientas nuevas: `backend/scripts/test-local.sh` (MySQL descartable + Firebase simulado, aborta si la base no es la descartable) y `backend/test/support/fake-firebase.js`.

**2B — Login del personal** (no empezado):
1. Inactividad por tipo: admin/caja `auth.idle_minutes_admin` (30), mozo `auth.idle_minutes_waiter` (240), cocina sin cierre.
2. Hora de cierre del local: el backend rechaza tokens con `auth_time` anterior al último cierre (no se saltea desde el front).
3. Aviso 1 min antes con botón "Sigo acá".

## Agenda de funciones nuevas (pedidas 2026-11-06, después del plan)
1. **Imágenes de productos.** La DB ya tiene `products.image_url` y el backend lo acepta, pero no hay subida ni se muestra en ninguna pantalla. No guardar imágenes en MySQL (límite 10 MB) ni en disco de Render (se borra). Propuesta: Firebase Storage.
2. **Imágenes livianas automáticas.** Achicar en el navegador antes de subir (WebP, ~800 px y miniatura ~300 px, ~50-100 KB), carga diferida (`loading="lazy"`) y tamaño fijo en la grilla. Así la web y la app no se ponen pesadas.
3. **Carrusel "Ofertas del día"** arriba del menú del comensal.
4. **Promociones visibles** para el comensal. El módulo `promotions` ya existe (admin + aplicación por el staff); falta mostrarlas en el menú.

Regla: una por vez, con test que falle antes, suite completa e informe; no empezar la siguiente sin visto bueno.

## Entorno local (cuidado)
- `.env` de la raíz apunta a `127.0.0.1:3307`, ocupado por `mysql_local` (otro proyecto: no tocar).
- Probar con un MySQL descartable en otro puerto y `DB_*` por variable de entorno (dotenv no las pisa).
- Firebase: dejar `FIREBASE_SERVICE_ACCOUNT*` vacías o usar un preload que simule `firebase-admin`.
- Pendiente del dueño: agregar `https://localhost` a `CORS_ORIGINS` en Render (app Android) y regenerar el APK.
- Pendiente del dueño: revisar en la consola de Firebase si quedaron usuarios `test-*` de la corrida del 2026-10-30.
