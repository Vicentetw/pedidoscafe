# Lógica de negocio

## Mesa (table_sessions)
`OPEN → ORDERING → SERVING → BILL_REQUESTED → PARTIALLY_PAID → PAID → CLOSED`; terminales: `CLOSED`, `FORCE_CLOSED`, `ABANDONED`.
- El comensal escanea el QR, entra con un nombre y recibe un JWT. Nombre repetido → `NAME_TAKEN`, salvo "soy yo" (`claim`).
- Cerrar exige `paid == total` (con la fila bloqueada). Cierre forzado: permiso propio, queda auditado.
- Una mesa terminal no acepta escrituras de pedidos (staff ni comensal); staff sí puede cancelar.

## Pedido (orders)
`DRAFT → SUBMITTED → VALIDATING_STOCK → CONFIRMED → QUEUED → PREPARING → READY → DELIVERED → COMPLETED`; además `REJECTED_STOCK`, `CANCEL_REQUESTED`, `CANCELLED`.
- Precio siempre calculado en backend desde códigos.
- Submit: reserva stock de ingredientes (pesimista) y descuenta stock simple; arma un ticket por estación; suma al total de la mesa.
- Edición: libre en `DRAFT`; con `orders:amend_paid` staff edita en `CONFIRMED/QUEUED`; el comensal nunca después de enviar.
- Cocina: avanzar un ticket mueve el pedido al mínimo de sus tickets; en `DELIVERED` consume la reserva.
- Cancelar: comensal sólo antes de preparación; staff en `PREPARING` con `orders:cancel_after_prep`.

## Pago
Modos `GROUP` (saldo de la mesa), `INDIVIDUAL` (lo del participante), `SPLIT` (monto/partes iguales, sólo efectivo); proveedor `CASH` o `MERCADOPAGO`.
- Efectivo liquida en el momento; MP crea checkout y se confirma por webhook o "Verificar pago".
- Lo pagado nunca supera el total: el excedente queda como devolución `PENDING`.
- GROUP/INDIVIDUAL marcan los pedidos `PAID`; SPLIT no.
- Fidelización: sólo suma puntos en cobros de mostrador (`chargeOrder`), no en mesas.

## Stock
Dos sistemas excluyentes por producto: recetas/ingredientes (reserva → consumo/liberación, TTL 240 min por defecto) o stock simple por producto (descuento atómico).

## Permisos
`modulo:accion` de `shared/permissions.js`; roles de sistema en la migración 0002 + roles propios por empresa + overrides ALLOW/DENY por usuario. `staff.mozo_can_charge` agrega `payments:view/charge` al mozo.
