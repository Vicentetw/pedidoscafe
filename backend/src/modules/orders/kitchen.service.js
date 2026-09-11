const pool = require('../../db');
const kitchenRepo = require('./kitchen.repository');
const orderRepo = require('./orders.repository');
const branchRepo = require('../platform/branches.repository');
const { withTransaction } = require('../../withTransaction');
const { enqueue } = require('../../events/outbox');
const { publish } = require('../../http/sse');
const { writeAudit } = require('../../audit/audit');
const { NotFoundError, ConflictError, ValidationError } = require('../../errors');
const stockService = require('../inventory/stock.service');
const devicesService = require('../devices/devices.service');

// -------- estaciones / ruteo (setup, permiso tables:manage)
async function listStations(tenantId, branchId) {
  return kitchenRepo.listStations(tenantId, branchId);
}
async function createStation(tenantId, input, req) {
  if (!(await branchRepo.findById(tenantId, input.branchId))) throw new ValidationError('Esa sucursal no existe en tu empresa.');
  if (await kitchenRepo.findStationByCode(tenantId, input.branchId, input.code)) {
    throw new ConflictError('Ya existe una estación con ese código en esa sucursal.');
  }
  const id = await kitchenRepo.createStation(tenantId, input);
  await writeAudit({ req, tenantId, branchId: input.branchId, entityType: 'kitchen_station', entityId: id, action: 'create', after: input });
  return kitchenRepo.findStation(tenantId, id);
}
async function deleteStation(tenantId, id, req) {
  const st = await kitchenRepo.findStation(tenantId, id);
  if (!st) throw new NotFoundError('Esa estación no existe.');
  await kitchenRepo.deleteStation(tenantId, id);
  await writeAudit({ req, tenantId, branchId: st.branch_id, entityType: 'kitchen_station', entityId: id, action: 'delete', before: st });
}
async function listRouting(tenantId, branchId) {
  return kitchenRepo.listRouting(tenantId, branchId);
}
async function setRouting(tenantId, branchId, input, req) {
  if ((input.productId == null) === (input.categoryId == null)) {
    throw new ValidationError('Indicá exactamente uno: productId o categoryId.');
  }
  const st = await kitchenRepo.findStation(tenantId, input.stationId);
  if (!st || st.branch_id !== branchId) throw new ValidationError('Esa estación no pertenece a esa sucursal.');
  await kitchenRepo.upsertRouting(tenantId, branchId, input);
  await writeAudit({ req, tenantId, branchId, entityType: 'station_routing', entityId: String(input.productId ?? 'c' + input.categoryId), action: 'set', after: input });
  return kitchenRepo.listRouting(tenantId, branchId);
}
async function deleteRouting(tenantId, id, req) {
  await kitchenRepo.deleteRouting(tenantId, id);
  await writeAudit({ req, tenantId, entityType: 'station_routing', entityId: id, action: 'delete' });
}

// -------- tablero (KDS)
async function board(tenantId, branchId, filters) {
  return kitchenRepo.listBoard(tenantId, branchId, filters);
}

const FLOW = ['QUEUED', 'PREPARING', 'READY', 'DELIVERED'];
const TICKET_NEXT = { QUEUED: 'PREPARING', PREPARING: 'READY', READY: 'DELIVERED' };
const rank = (s) => FLOW.indexOf(s);
const cap = (s) => s.charAt(0) + s.slice(1).toLowerCase();
const stampFor = (s) => (s === 'PREPARING' ? { started_at: 'now' } : s === 'READY' ? { ready_at: 'now' } : s === 'DELIVERED' ? { delivered_at: 'now' } : {});

// Avanza un ticket un paso y recalcula el estado del pedido: sigue al
// ticket MENOS avanzado, moviéndose un estado por vez (las transiciones
// QUEUED→PREPARING→READY→DELIVERED son válidas consecutivas). DELIVERED
// del pedido queda bloqueado si hay verificación de edad pendiente (§28).
async function advanceTicket(tenantId, ticketId, req, actorId) {
  const out = await withTransaction(async (conn) => {
    const ticket = await kitchenRepo.findTicket(tenantId, ticketId, conn);
    if (!ticket) throw new NotFoundError('Ese ticket no existe.');
    const ticketTo = TICKET_NEXT[ticket.status];
    if (!ticketTo) throw new ConflictError('Ese ticket ya está entregado.');
    await kitchenRepo.setTicketStatus(tenantId, ticketId, ticketTo, ticketTo === 'PREPARING' ? 'started' : ticketTo === 'READY' ? 'ready' : 'delivered', conn);

    const order = await orderRepo.lockOrder(tenantId, ticket.order_id, conn);
    let orderStatus = order.status;
    if (['QUEUED', 'PREPARING', 'READY'].includes(order.status)) {
      const tickets = await kitchenRepo.ticketsForOrder(tenantId, ticket.order_id, conn);
      let targetRank = Math.min(...tickets.map((t) => rank(t.status)));
      let target = FLOW[targetRank];
      if (target === 'DELIVERED') {
        const pendingAge = await orderRepo.countUnresolvedAgeChecks(tenantId, ticket.order_id, conn);
        if (pendingAge > 0) target = 'READY';
      }
      let cur = order.status;
      while (rank(cur) < rank(target)) {
        const next = FLOW[rank(cur) + 1];
        await orderRepo.recordEvent(tenantId, ticket.order_id, cur, next, { actorKind: 'staff', actorId }, conn);
        await orderRepo.updateOrderStatus(tenantId, ticket.order_id, next, stampFor(next), conn);
        cur = next;
      }
      let justBecameReady = false;
      if (cur !== order.status) {
        await orderRepo.setItemKitchenStatus(tenantId, ticket.order_id, cur, conn);
        // Al ENTREGAR: consumir el stock reservado (baja on_hand + reserved).
        if (cur === 'DELIVERED') {
          await stockService.consumeForOrder(tenantId, ticket.order_id, conn);
        }
        await enqueue(conn, { tenantId, branchId: ticket.branch_id, type: `Order${cap(cur)}`, payload: { orderId: ticket.order_id } });
        orderStatus = cur;
        justBecameReady = cur === 'READY';
      }
      return { ticketStatus: ticketTo, orderId: ticket.order_id, orderStatus, branchId: ticket.branch_id, sessionId: order.session_id, justBecameReady };
    }
    return { ticketStatus: ticketTo, orderId: ticket.order_id, orderStatus, branchId: ticket.branch_id, sessionId: order.session_id, justBecameReady: false };
  });

  publish({ tenantId, branchId: out.branchId, topic: 'kitchen', event: 'ticket_advanced', data: { ticketId, status: out.ticketStatus } });
  publish({ tenantId, branchId: out.branchId, topic: 'orders', event: 'order_status', data: { orderId: out.orderId, status: out.orderStatus } });
  if (out.sessionId) {
    const [[s]] = await pool.query(`SELECT public_id FROM table_sessions WHERE id = :id`, { id: out.sessionId });
    const [[o]] = await pool.query(`SELECT public_id FROM orders WHERE id = :id`, { id: out.orderId });
    publish({ tenantId, branchId: out.branchId, topic: 'session', event: 'order_status',
      data: { sessionId: s?.public_id, orderPublicId: o?.public_id, status: out.orderStatus } });
  }
  // Aviso (buzzer + digital, Fase 13) — DESPUÉS de que la transacción
  // confirmó; notifyOrderReady lee con su propia conexión y necesita ver el
  // status ya commiteado. Nunca tira (ver el try/catch adentro).
  if (out.justBecameReady) await devicesService.notifyOrderReady(tenantId, out.orderId);
  return out;
}

module.exports = {
  listStations, createStation, deleteStation,
  listRouting, setRouting, deleteRouting,
  board, advanceTicket,
};
