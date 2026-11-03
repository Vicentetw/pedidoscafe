# Dependencias entre módulos

```
orders.service ──► stock.service, catalog.repository, crm.repository,
                   promotions.service, tables.repository, payments.service (require diferido)
payments.service ─► cash.service/repo, loyalty.service, orders.repository, tables.repository
promotions.service ─► orders.repository, orders.service (require diferido: CICLO), loyalty.repository
kitchen.service ──► stock.service, devices.service, orders.repository
fiscal.service ───► orders.repository, tables.repository
auth/sessionToken ─► tables.repository, tableSession.stateMachine
appUserRepository ─► platform/settings.repository (permiso mozo_can_charge)
branches.repository ◄── 9 módulos   ·   catalog/pricing (toCents/fromCents) ◄── 6 módulos
```

## Efectos de tocar cada pieza
| Pieza | Afecta |
|---|---|
| `pricing.js` | Todo cálculo de dinero: pedidos, pagos, caja, fiscal, promos, analítica |
| `recomputeSessionTotal` / `syncSessionStatus` | Saldo y estado de mesa, cierre, cobro, cancelación, enmiendas |
| `tables.repository.lockSession` | Orden de locks de pedidos, pagos y cierre (deadlocks) |
| `tableSessionMiddleware` | Toda la superficie del comensal, incluido SSE y pagos |
| `order.stateMachine` / `tableSession.stateMachine` | Cocina, cobro, cierre, analítica |
| `orders.payment_status` | Analítica, fiscal, promociones (no se aplican si ya está pagado), conciliación |
| `settings` | Permisos del mozo, pago individual, TTL de reservas |
| `http/sse.publish` | Frontend en vivo (mesas, cocina, comensal, aviso de pedidos nuevos) |

Ciclos resueltos con `require` dentro de funciones: no moverlos al tope del archivo.
