# Handoff para el próximo agente

Última actualización: 2026-11-07 · falla 6 publicada.

## Estado
- Producción arriba: backend `https://pedidoscafe.onrender.com`, frontend `restiapedidos.web.app`. El dueño aún no lo usa con clientes reales.
- Suite backend: 310 tests (57 archivos), 310/310 con Firebase simulado.
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
| 7 | Analítica y conciliación | **Siguiente** |
| 8 | Validaciones adicionales y seguridad | Pendiente |

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
- Pendiente del dueño: revisar en la consola de Firebase si quedaron usuarios `test-*` de la corrida del 2026-10-30.
