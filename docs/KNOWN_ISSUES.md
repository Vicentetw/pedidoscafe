# Problemas conocidos

Numeración = orden del plan de corrección. "Reproducido" = probado por HTTP el 2026-10-30; "Código" = visto al leer, no reproducido.

## Plan de corrección
| # | Problema | Evidencia | Estado |
|---|---|---|---|
| 1 | Pedidos con mesa cerrada o participante quitado | Reproducido | Corregido `74e1513` |
| 2 | `createOrder` no valida sucursal/mesa/cliente del tenant; `recomputeSessionTotal` suma pedidos sin filtrar tenant | Reproducido | Corregido `7be7f81` |
| 3 | Webhook MP: idempotencia por `topic:data.id` pierde `in_process→approved`; responde 200 si falla | Reproducido | Abierto |
| 3b | Webhook sin lock del pago vs. "Verificar pago" con lock → posible doble crédito | Código | Abierto |
| 3c | Llamadas a MP (refund, re-consulta) dentro de transacciones con filas bloqueadas | Código | Abierto |
| 4 | La UI nunca manda `cashSessionId`: ventas fuera de la caja física | Reproducido | Abierto |
| 5 | Cancelar un pedido pagado no devuelve ni avisa; las devoluciones no revierten puntos | Reproducido / Código | Abierto |
| 5b | `updateItem` en pedido confirmado no ajusta stock ni avisa a cocina; enmiendas `amend_paid` sin auditoría | Código | Abierto |
| 6 | Sin stock responde HTTP 200 con error; el frontend lo toma como éxito | Reproducido | Abierto |
| 7 | Analítica: SPLIT no cuenta como venta, cancelados pagados sí | Reproducido | Abierto |
| 7b | `/payments/reconciliation` tapada por `/:id` (500) y la UI oculta el error | Reproducido | Abierto |
| 8 | Validaciones y seguridad (abajo) | Código | Abierto |

## Para el punto 8
- Interceptor del frontend pisa el Bearer del comensal con el de Firebase si hay staff logueado en el mismo navegador.
- `render.yaml` fija `SESSION_TOKEN_TTL_HOURS=2`; el código dice que 2 h causaba participantes duplicados (default 6). Verificar el valor real en Render.
- `API_KEY` vacía en el frontend: capa 1 desactivada; si se carga en Render, el staff recibe 401.
- `/api/stream` sin permiso: cualquier usuario del tenant ve eventos de pagos y de todas las sucursales.
- `POST /analytics/rollup/recompute` escribe con permiso de lectura.
- Job de reservas vencidas libera sin mirar el estado: un pedido entregado pasados 240 min no consume stock.
- `domain_events` sin consumidores y sin purga (límite 10 MB).
- Propinas: backend sí, UI no; el checkout de MP no incluye la propina.
- Puntos de fidelización sólo en cobros de mostrador, no en mesas.
- Sin lock: `forceCloseSession`, `completeOrder`, `cash.addMovement`, `advanceTicket`.
- Comensal puede quitar a otros, agregar participantes sin límite y tomar otra identidad con "soy yo".
- Quitar a alguien no lo veta (puede re-escanear el QR); SSE ya abierta no se corta; `session_closed` no llega al comensal.
- Firma del webhook opcional (mitigado por la re-consulta a MP).

## No cambiar sin decisión explícita
- Staff puede cancelar pedidos en mesa cerrada.
- El comensal puede consultar lo consumido con la mesa cerrada (GET).
- Lógica duplicada de ruteo a cocina (`submitOrder` y `routeItemsToKitchen`): corregir ambas copias.
