# Funciones críticas

No cambiarlas sin revisar `MODULE_DEPENDENCIES.md` y correr la suite completa.

| Función | Archivo | Invariante que protege |
|---|---|---|
| `submitOrder` | `orders/orders.service.js` | Lock mesa → pedido; mesa terminal rechaza; reenvío de CONFIRMED/QUEUED idempotente; stock reservado o rechazo completo |
| `addItem` / `updateItem` / `removeItem` / `cancelOrder` | idem | Recalcular total de mesa y estado tras enmiendas |
| `chargeSession` / `splitEqual` / `chargeOrder` | `payments/payments.service.js` | Lock de mesa; nunca cobrar más que el saldo |
| `applyApprovedAmount` / `syncSessionStatus` | idem | `paid_amount <= total_amount`; estado coherente con el saldo |
| `processMpWebhookNotification` / `checkPendingMpPayment` | idem | Nunca confiar en el payload: re-consultar a MP; idempotencia |
| `refundPayment` | idem | No devolver más de lo cobrado |
| `closeSession` / `forceCloseSession` | `tables/tables.service.js` | Cerrar sólo saldada (o forzada, auditada) |
| `recomputeSessionTotal` | `orders/orders.repository.js` | Total de mesa = suma de pedidos activos |
| `reserveForOrder` / `releaseForOrder` / `consumeForOrder` | `inventory/stock.service.js` | Locks en orden de id (sin deadlocks); sin sobreventa |
| `validateAndDecrementSimpleStock` | `orders/orders.service.js` | Descuento atómico y compensación si falla uno |
| `tableSessionMiddleware` | `auth/sessionToken.js` | El scope del comensal sale del token, revalidado en DB |
| `appUserMiddleware` / `resolveTenantId` / `requirePermission` | `auth/appUserMiddleware.js` | Un usuario nunca opera fuera de su tenant |
| `isPublicPath` | `http/security.js` | `/api/publicidad` no es público |
| `toCents` / `fromCents` / `priceLine` | `catalog/pricing.js` | Dinero en centavos enteros |

Orden de locks obligatorio: **sesión de mesa → pedido → stock**.
