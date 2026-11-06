# Handoff para el próximo agente

Última actualización: 2026-11-04 · falla 4 publicada.

## Estado
- Producción arriba: backend `https://pedidoscafe.onrender.com`, frontend `restiapedidos.web.app`. El dueño aún no lo usa con clientes reales.
- Suite backend: 300 tests (54 archivos), 300/300 con Firebase simulado.
- Falla 2 y `docs/` publicados en `main`.
- Auditoría completa de solo lectura hecha el 2026-11-03; hallazgos en `KNOWN_ISSUES.md`.

## Plan de corrección (orden fijado por el dueño)
| # | Tema | Estado |
|---|---|---|
| 1 | Pedidos con mesa cerrada / participante quitado | Hecho y publicado (`74e1513`) |
| 2 | Aislamiento multiempresa en pedidos | Hecho y publicado (`7be7f81`) |
| 3 | Webhook y transiciones de MercadoPago | Hecho y publicado (refund de MP pasa a la 5) |
| 4 | Efectivo y movimientos de caja | Hecho y publicado (frontend: deploy manual a Firebase) |
| 5 | Cancelaciones, devoluciones y saldos (incluye refund de MP fuera de transacción) | **Siguiente** |
| 6 | Respuestas HTTP y falta de stock | Pendiente |
| 7 | Analítica y conciliación | Pendiente |
| 8 | Validaciones adicionales y seguridad | Pendiente |

Regla: una por vez, con test que falle antes, suite completa e informe; no empezar la siguiente sin visto bueno.

## Entorno local (cuidado)
- `.env` de la raíz apunta a `127.0.0.1:3307`, ocupado por `mysql_local` (otro proyecto: no tocar).
- Probar con un MySQL descartable en otro puerto y `DB_*` por variable de entorno (dotenv no las pisa).
- Firebase: dejar `FIREBASE_SERVICE_ACCOUNT*` vacías o usar un preload que simule `firebase-admin`.
- Pendiente del dueño: revisar en la consola de Firebase si quedaron usuarios `test-*` de la corrida del 2026-10-30.
