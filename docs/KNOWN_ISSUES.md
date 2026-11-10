# Problemas conocidos

Numeración = orden del plan de corrección. "Reproducido" = probado por HTTP el 2026-10-30; "Código" = visto al leer, no reproducido.

## Plan de corrección
| # | Problema | Evidencia | Estado |
|---|---|---|---|
| 1 | Pedidos con mesa cerrada o participante quitado | Reproducido | Corregido `74e1513` |
| 2 | `createOrder` no valida sucursal/mesa/cliente del tenant; `recomputeSessionTotal` suma pedidos sin filtrar tenant | Reproducido | Corregido `7be7f81` |
| 3 | Webhook MP: idempotencia por `topic:data.id` pierde `in_process→approved`; responde 200 si falla | Reproducido | Corregido (falla 3) |
| 3b | Webhook sin lock del pago vs. "Verificar pago" con lock → posible doble crédito | Reproducido | Corregido (falla 3) |
| 3c | Llamadas a MP dentro de transacciones: re-consultas corregidas (falla 3); **refund pendiente → falla 5** (registrar devolución PENDING antes de llamar a MP, `X-Idempotency-Key`, probar en sandbox) | Código | Parcial |
| 4 | La UI nunca manda `cashSessionId`: ventas fuera de la caja física; el backend aceptaba una caja de otra sucursal | Reproducido | Corregido (falla 4) |
| 5 | Cancelar un pedido pagado no devuelve ni avisa; las devoluciones no revierten puntos | Reproducido / Código | Aviso + motivo + auditoría + conciliación (publicado). **Devolución y reversa de puntos: congeladas** |
| 5b | `updateItem` en pedido confirmado no ajusta stock ni avisa a cocina; enmiendas `amend_paid` sin auditoría | Reproducido | Corregido (falla 5). Stock de ingredientes/recetas sigue sin ajustarse por ítem (limitación previa) |
| 6 | Sin stock responde HTTP 200 con error; el frontend lo toma como éxito | Reproducido | Corregido: 409 con el mismo mensaje y code; "Enviar todos" avisa los no enviados |
| 7 | Analítica: SPLIT no cuenta como venta, cancelados pagados sí | Reproducido | Corregido (falla 7). Pagos SPLIT viejos y `daily_sales_rollup` ya calculado no se corrigen solos: recalcular el rollup |
| 7b | `/payments/reconciliation` tapada por `/:id` (500) y la UI oculta el error | Reproducido | Corregido: ruta (falla 5) y la tarjeta muestra el error (falla 7) |
| 8 | Validaciones y seguridad (abajo) | Código | Abierto |

## Para el punto 8
- Interceptor del frontend pisa el Bearer del comensal con el de Firebase si hay staff logueado en el mismo navegador.
- `render.yaml` fija `SESSION_TOKEN_TTL_HOURS=2`; el código dice que 2 h causaba participantes duplicados (default 6). Verificar el valor real en Render.
- `API_KEY` vacía en el frontend: capa 1 desactivada; si se carga en Render, el staff recibe 401.
- `/api/stream` sin permiso: cualquier usuario del tenant ve eventos de pagos y de todas las sucursales.
- `POST /analytics/rollup/recompute` escribe con permiso de lectura.
- Job de reservas vencidas libera sin mirar el estado: un pedido entregado pasados 240 min no consume stock.
- ~~`domain_events` sin purga~~ corregido (purga diaria). **El plan de 10 MB alcanza para ~900 pedidos**: subir de plan antes de vender.
- Pendiente: mesas abiertas indefinidamente (`orders.abandon_timeout_minutes` existe pero nada lo usa) y login del personal sin vencimiento. Dueño pidió tiempo y horario configurables.
- Refund de MP (congelado) llama a la red con la conexión de la transacción abierta.
- Propinas: backend sí, UI no; el checkout de MP no incluye la propina.
- Puntos de fidelización sólo en cobros de mostrador, no en mesas.
- Sin lock: `forceCloseSession`, `completeOrder`, `cash.addMovement`, `advanceTicket`.
- Comensal puede quitar a otros, agregar participantes sin límite y tomar otra identidad con "soy yo".
- Quitar a alguien no lo veta (puede re-escanear el QR); SSE ya abierta no se corta; `session_closed` no llega al comensal.
- Firma del webhook opcional (mitigado por la re-consulta a MP).

## Vistos durante la falla 4 (no corregidos)
- No hay pantalla para cobrar pedidos de mostrador (`POST /payments/orders/:id/charge` existe, ninguna UI lo llama).
- Un mozo con `staff.mozo_can_charge` no tiene `cash:view`: no ve las cajas; con una sola abierta funciona, con varias no puede elegir.

## Vistos durante la falla 8 (no corregidos)
- `settings.repository.get()` devuelve el valor de EMPRESA aunque la sucursal tenga uno propio (orden invertido). `getAll()` está bien. El código nuevo usa `getAll`.
- 2026-11-10: con Docker apagado y el archivo de entorno de prueba borrado, una corrida de test arrancó con el `.env` real (MySQL local de 3307) y se cortó; pudo dejar filas del tenant de prueba 998915 en esa base local. Por eso existe `scripts/test-local.sh`.

## No cambiar sin decisión explícita
- Sin caja abierta no se cobra en efectivo (decidido 2026-11-05).
- Staff puede cancelar pedidos en mesa cerrada.
- El comensal puede consultar lo consumido con la mesa cerrada (GET).
- Lógica duplicada de ruteo a cocina (`submitOrder` y `routeItemsToKitchen`): corregir ambas copias.
