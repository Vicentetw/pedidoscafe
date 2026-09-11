const pool = require('../../db');
const repo = require('./orders.repository');
const kitchenRepo = require('./kitchen.repository');
const { priceLine, toCents, fromCents } = require('../catalog/pricing');
const { assertTransition, TERMINAL, GUEST_CANCELLABLE } = require('./order.stateMachine');
const { withTransaction } = require('../../withTransaction');
const { enqueue } = require('../../events/outbox');
const { publish } = require('../../http/sse');
const { writeAudit } = require('../../audit/audit');
const { NotFoundError, ConflictError, ValidationError, ForbiddenError, DomainError } = require('../../errors');

// ---------------------------------------------------------------------------
// STOCK — reserva pesimista (Fase 5). Corre DENTRO de la transacción del
// submit; `SELECT ... FOR UPDATE` sobre las filas de `stock`.
const stockService = require('../inventory/stock.service');
const crmRepo = require('../crm/crm.repository');
const promotionsService = require('../promotions/promotions.service');
async function validateAndReserveStock(tenantId, branchId, items, conn, orderId) {
  return stockService.reserveForOrder(tenantId, branchId, orderId, items, conn);
}
async function releaseStockFor(tenantId, orderId, conn) {
  return stockService.releaseForOrder(tenantId, orderId, conn);
}
// ---------------------------------------------------------------------------

async function resolvePricedItem(tenantId, branchId, input, conn = pool) {
  const [[product]] = await conn.query(
    `SELECT id, category_id, name, base_price, currency, requires_age_verification
       FROM products WHERE tenant_id = :tenantId AND code = :code AND is_active = 1 AND deleted_at IS NULL`,
    { tenantId, code: input.productCode }
  );
  if (!product) throw new ValidationError(`El producto "${input.productCode}" no está disponible.`);

  const [[override]] = await conn.query(
    `SELECT price, is_available FROM product_branch_overrides WHERE product_id = :pid AND branch_id = :bid`,
    { pid: product.id, bid: branchId }
  );
  if (override && override.is_available === 0) {
    throw new ConflictError(`"${product.name}" no está disponible en esta sucursal.`, { code: 'ITEM_UNAVAILABLE' });
  }

  let variant = null;
  let variantSnapshot = null;
  if (input.variantCode) {
    const [[v]] = await conn.query(
      `SELECT id, name, price_delta FROM product_variants
        WHERE tenant_id = :tenantId AND product_id = :pid AND code = :code AND is_active = 1`,
      { tenantId, pid: product.id, code: input.variantCode }
    );
    if (!v) throw new ValidationError('Esa variante no existe.');
    variant = v;
    variantSnapshot = v.name;
  }

  const modifiers = [];
  if (input.modifierCodes && input.modifierCodes.length) {
    const [rows] = await conn.query(
      `SELECT m.id, m.code, m.name, m.price_delta FROM modifiers m
         JOIN product_modifier_groups pmg ON pmg.group_id = m.group_id AND pmg.product_id = :pid
        WHERE m.tenant_id = :tenantId AND m.is_active = 1`,
      { tenantId, pid: product.id }
    );
    const allowed = new Map(rows.map((r) => [r.code, r]));
    for (const c of input.modifierCodes) {
      const m = allowed.get(c);
      if (!m) throw new ValidationError(`El extra "${c}" no aplica a este producto.`);
      modifiers.push({ modifierId: m.id, nameSnapshot: m.name, priceDelta: fromCents(toCents(m.price_delta)) });
    }
  }

  const priced = priceLine({
    product,
    branchOverridePrice: override ? override.price : null,
    variant,
    modifiers: modifiers.map((m) => ({ price_delta: m.priceDelta })),
    qty: input.qty,
  });

  return {
    productId: product.id,
    categoryId: product.category_id,
    variantId: variant ? variant.id : null,
    nameSnapshot: product.name,
    variantSnapshot,
    unitPrice: priced.unitPrice,
    modifiersTotal: priced.modifiersTotal,
    lineTotal: priced.lineTotal,
    qty: Math.max(1, Math.trunc(input.qty)),
    modifiers,
    requiresAge: !!product.requires_age_verification,
    currency: product.currency,
  };
}

function sumTotals(items) {
  const subtotalCents = items.reduce((a, i) => a + toCents(i.line_total ?? i.lineTotal), 0);
  return { subtotal: fromCents(subtotalCents), discount: '0.00', tax: '0.00', tip: '0.00', total: fromCents(subtotalCents) };
}

// ============================================================ crear / editar
async function createOrder(tenantId, { branchId, sessionId = null, participantId = null, customerId = null, channel, note }, createdBy) {
  const { id, publicId } = await repo.createOrder(tenantId, {
    branchId, sessionId, participantId, customerId, channel, note,
    createdByKind: createdBy.kind, createdBy: createdBy.actorId ?? null,
  });
  await repo.recordEvent(tenantId, id, null, 'DRAFT', { actorKind: createdBy.kind, actorId: createdBy.actorId });
  // CRM (Fase 9) — sólo si el pedido ya nace con un cliente identificado
  // (típicamente mostrador; en mesa se linkea después vía el participante).
  if (customerId) await crmRepo.touchLastOrder(tenantId, customerId).catch(() => {});
  return getOrder(tenantId, id);
}

async function getOrder(tenantId, id) {
  const o = await repo.findOrder(tenantId, id);
  if (!o) throw new NotFoundError('Ese pedido no existe.');
  const items = await repo.listItems(tenantId, id);
  return { ...o, items };
}

function assertDraft(order) {
  if (!['DRAFT', 'REJECTED_STOCK'].includes(order.status)) {
    throw new ConflictError('Este pedido ya fue enviado; no se puede editar.', { code: 'ORDER_NOT_EDITABLE' });
  }
}

async function addItem(tenantId, orderId, input, actor) {
  const order = await repo.findOrder(tenantId, orderId);
  if (!order) throw new NotFoundError('Ese pedido no existe.');
  assertDraft(order);
  const priced = await resolvePricedItem(tenantId, order.branch_id, input, pool);

  await withTransaction(async (conn) => {
    await repo.addItem(tenantId, orderId, {
      ...priced,
      participantId: order.participant_id,
      note: input.note ?? null,
    }, conn);
    const items = await repo.listItems(tenantId, orderId, conn);
    await repo.setOrderTotals(tenantId, orderId, sumTotals(items), conn);
    await promotionsService.recomputeDiscountForOrder(tenantId, orderId, items, conn); // no-op si no hay promo aplicada
  });

  if (order.session_id) {
    publish({ tenantId, branchId: order.branch_id, topic: 'session', event: 'someone_ordering',
      data: { sessionId: await sessionPublicId(order.session_id), participantId: order.participant_id } });
  }
  return getOrder(tenantId, orderId);
}

async function updateItem(tenantId, orderId, itemId, { qty }, actor) {
  const order = await repo.findOrder(tenantId, orderId);
  if (!order) throw new NotFoundError('Ese pedido no existe.');
  assertDraft(order);
  const item = await repo.findItem(tenantId, orderId, itemId);
  if (!item) throw new NotFoundError('Ese ítem no existe en el pedido.');
  const q = Math.max(1, Math.trunc(qty));
  const unitCents = toCents(item.unit_price) + toCents(item.modifiers_total);
  await withTransaction(async (conn) => {
    await repo.updateItemQty(tenantId, orderId, itemId, q, item.unit_price, item.modifiers_total, fromCents(unitCents * q), conn);
    const items = await repo.listItems(tenantId, orderId, conn);
    await repo.setOrderTotals(tenantId, orderId, sumTotals(items), conn);
    await promotionsService.recomputeDiscountForOrder(tenantId, orderId, items, conn);
  });
  return getOrder(tenantId, orderId);
}

async function removeItem(tenantId, orderId, itemId, actor) {
  const order = await repo.findOrder(tenantId, orderId);
  if (!order) throw new NotFoundError('Ese pedido no existe.');
  assertDraft(order);
  await withTransaction(async (conn) => {
    await repo.deleteItem(tenantId, orderId, itemId, conn);
    const items = await repo.listItems(tenantId, orderId, conn);
    await repo.setOrderTotals(tenantId, orderId, sumTotals(items), conn);
    await promotionsService.recomputeDiscountForOrder(tenantId, orderId, items, conn);
  });
  return getOrder(tenantId, orderId);
}

// ============================================================ submit
async function submitOrder(tenantId, orderId, actor) {
  const result = await withTransaction(async (conn) => {
    const order = await repo.lockOrder(tenantId, orderId, conn);
    if (!order) throw new NotFoundError('Ese pedido no existe.');
    if (order.status === 'CONFIRMED' || order.status === 'QUEUED') return { order, alreadyConfirmed: true };
    if (!['DRAFT', 'REJECTED_STOCK'].includes(order.status)) {
      throw new ConflictError('Este pedido ya no se puede enviar.', { code: 'ORDER_NOT_SUBMITTABLE' });
    }
    const items = await repo.listItems(tenantId, orderId, conn);
    if (!items.length) throw new ValidationError('El pedido no tiene ningún ítem.');

    const from = order.status;
    await repo.recordEvent(tenantId, orderId, from, 'SUBMITTED', { actorKind: actor.kind, actorId: actor.actorId }, conn);
    await repo.updateOrderStatus(tenantId, orderId, 'SUBMITTED', { ordered_at: 'now' }, conn);
    await repo.recordEvent(tenantId, orderId, 'SUBMITTED', 'VALIDATING_STOCK', { actorKind: 'system' }, conn);
    await repo.updateOrderStatus(tenantId, orderId, 'VALIDATING_STOCK', {}, conn);

    const stock = await validateAndReserveStock(tenantId, order.branch_id, items, conn, orderId);
    if (!stock.ok) {
      await repo.recordEvent(tenantId, orderId, 'VALIDATING_STOCK', 'REJECTED_STOCK', { actorKind: 'system', reason: 'stock' }, conn);
      await repo.updateOrderStatus(tenantId, orderId, 'REJECTED_STOCK', {}, conn);
      return { order, rejected: stock.unavailable || [] };
    }

    await repo.setOrderTotals(tenantId, orderId, sumTotals(items), conn);
    await promotionsService.recomputeDiscountForOrder(tenantId, orderId, items, conn);
    await repo.recordEvent(tenantId, orderId, 'VALIDATING_STOCK', 'CONFIRMED', { actorKind: 'system' }, conn);
    await repo.updateOrderStatus(tenantId, orderId, 'CONFIRMED', { accepted_at: 'now' }, conn);

    // Ruteo a estaciones -> tickets de cocina.
    const byStation = new Map();
    for (const it of items) {
      const stationId = await kitchenRepo.resolveStationFor(tenantId, order.branch_id, it.product_id, null, conn);
      await repo.setItemStation(tenantId, it.id, stationId, conn);
      const key = stationId ?? 0;
      if (!byStation.has(key)) byStation.set(key, { stationId, items: [] });
      byStation.get(key).items.push(it);
    }
    const ticketIds = [];
    for (const grp of byStation.values()) {
      const no = await kitchenRepo.nextTicketNo(tenantId, order.branch_id, conn);
      const tid = await kitchenRepo.createTicket(tenantId, order.branch_id, orderId, grp.stationId, no, grp.items, conn);
      ticketIds.push({ id: tid, stationId: grp.stationId, no });
    }
    await repo.setItemKitchenStatus(tenantId, orderId, 'QUEUED', conn);
    await repo.recordEvent(tenantId, orderId, 'CONFIRMED', 'QUEUED', { actorKind: 'system' }, conn);
    await repo.updateOrderStatus(tenantId, orderId, 'QUEUED', {}, conn);

    if (order.session_id) {
      await repo.recomputeSessionTotal(tenantId, order.session_id, conn);
      await conn.query(
        `UPDATE table_sessions SET status = 'SERVING' WHERE tenant_id = :tenantId AND id = :sid AND status IN ('OPEN','ORDERING')`,
        { tenantId, sid: order.session_id }
      );
      // Una mesa ya PAID puede seguir pidiendo (ej. un postre después de
      // pagar) — recomputeSessionTotal recién subió total_amount, así que
      // si eso reabrió un saldo, el estado tiene que dejar de decir "ya
      // está saldada" (PAID -> PARTIALLY_PAID es una transición válida de
      // la máquina de estados, pensada justo para este caso). Sin esto la
      // mesa queda con un saldo real pero mostrando "saldada" para siempre.
      await conn.query(
        `UPDATE table_sessions SET status = 'PARTIALLY_PAID'
          WHERE tenant_id = :tenantId AND id = :sid AND status = 'PAID' AND paid_amount < total_amount`,
        { tenantId, sid: order.session_id }
      );
    }
    await enqueue(conn, { tenantId, branchId: order.branch_id, type: 'OrderConfirmed', payload: { orderId, publicId: order.public_id } });
    for (const t of ticketIds) {
      await enqueue(conn, { tenantId, branchId: order.branch_id, type: 'KitchenTicketQueued', payload: { orderId, ticketId: t.id, stationId: t.stationId } });
    }
    return { order: await repo.findOrder(tenantId, orderId, conn), ticketIds };
  });

  if (result.rejected) {
    // avisar a las pantallas que la disponibilidad cambió (caso obligatorio 8)
    publish({ tenantId, branchId: result.order.branch_id, topic: 'menu', event: 'availability_changed', data: { items: result.rejected } });
    if (result.order.session_id) {
      publish({ tenantId, branchId: result.order.branch_id, topic: 'session', event: 'menu_availability_changed',
        data: { sessionId: await sessionPublicId(result.order.session_id), items: result.rejected } });
    }
    // lenguaje humano, NUNCA un 409 crudo (§59)
    throw new DomainError(
      result.rejected.length === 1
        ? `Justo se agotó: ${result.rejected[0].name}. Sacalo del pedido y probá de nuevo.`
        : 'Algunos productos se quedaron sin stock. Revisá el pedido y probá de nuevo.',
      { status: 200, code: 'ITEM_UNAVAILABLE', details: { items: result.rejected } }
    );
  }
  if (!result.alreadyConfirmed) {
    publish({ tenantId, branchId: result.order.branch_id, topic: 'orders', event: 'order_confirmed', data: { orderId, publicId: result.order.public_id } });
    publish({ tenantId, branchId: result.order.branch_id, topic: 'kitchen', event: 'ticket_new', data: { orderId } });
    if (result.order.session_id) {
      publish({ tenantId, branchId: result.order.branch_id, topic: 'session', event: 'order_confirmed',
        data: { sessionId: await sessionPublicId(result.order.session_id), orderPublicId: result.order.public_id } });
    }
  }
  return getOrder(tenantId, orderId);
}

// ============================================================ cancelar
async function cancelOrder(tenantId, orderId, { reason } = {}, actor) {
  const order = await repo.findOrder(tenantId, orderId);
  if (!order) throw new NotFoundError('Ese pedido no existe.');
  if (TERMINAL.has(order.status)) return getOrder(tenantId, orderId);
  if (['READY', 'DELIVERED'].includes(order.status)) {
    throw new ConflictError('El pedido ya está listo o entregado; no se puede cancelar.');
  }

  if (actor.kind === 'guest' && !GUEST_CANCELLABLE.has(order.status)) {
    throw new ForbiddenError('El pedido ya está en preparación. Pedile al personal que lo cancele.');
  }
  if (actor.kind === 'staff' && order.status === 'PREPARING' && !actor.canCancelAfterPrep) {
    throw new ForbiddenError('Cancelar un pedido en preparación requiere el permiso "orders:cancel_after_prep".', { details: { permission: 'orders:cancel_after_prep' } });
  }

  await withTransaction(async (conn) => {
    const fresh = await repo.lockOrder(tenantId, orderId, conn);
    if (TERMINAL.has(fresh.status)) return;
    if (['CONFIRMED', 'QUEUED', 'PREPARING'].includes(fresh.status)) {
      await repo.recordEvent(tenantId, orderId, fresh.status, 'CANCEL_REQUESTED', { actorKind: actor.kind, actorId: actor.actorId, reason }, conn);
      await repo.updateOrderStatus(tenantId, orderId, 'CANCEL_REQUESTED', {}, conn);
    }
    await repo.recordEvent(tenantId, orderId, 'CANCEL_REQUESTED', 'CANCELLED', { actorKind: actor.kind, actorId: actor.actorId, reason }, conn);
    await repo.updateOrderStatus(tenantId, orderId, 'CANCELLED', { cancelled_at: 'now', cancel_reason: reason ?? null }, conn);
    await conn.query(`DELETE FROM kitchen_tickets WHERE tenant_id = :tenantId AND order_id = :orderId`, { tenantId, orderId });
    await releaseStockFor(tenantId, orderId, conn);
    if (fresh.session_id) await repo.recomputeSessionTotal(tenantId, fresh.session_id, conn);
    await enqueue(conn, { tenantId, branchId: fresh.branch_id, type: 'OrderCancelled', payload: { orderId, reason } });
  });
  await writeAudit({ req: actor.req, tenantId, branchId: order.branch_id, entityType: 'order', entityId: orderId, action: 'cancel', before: { status: order.status }, reason });
  publish({ tenantId, branchId: order.branch_id, topic: 'orders', event: 'order_cancelled', data: { orderId } });
  publish({ tenantId, branchId: order.branch_id, topic: 'kitchen', event: 'ticket_removed', data: { orderId } });
  return getOrder(tenantId, orderId);
}

async function setPriority(tenantId, orderId, priority, actor) {
  const order = await repo.findOrder(tenantId, orderId);
  if (!order) throw new NotFoundError('Ese pedido no existe.');
  await repo.updateOrderPriority(tenantId, orderId, priority, pool);
  await writeAudit({ req: actor.req, tenantId, branchId: order.branch_id, entityType: 'order', entityId: orderId, action: 'set_priority', before: { priority: order.priority }, after: { priority } });
  publish({ tenantId, branchId: order.branch_id, topic: 'kitchen', event: 'ticket_updated', data: { orderId, priority } });
  return getOrder(tenantId, orderId);
}

async function verifyAge(tenantId, orderId, itemId, result, actor) {
  const order = await repo.findOrder(tenantId, orderId);
  if (!order) throw new NotFoundError('Ese pedido no existe.');
  const item = await repo.findItem(tenantId, orderId, itemId);
  if (!item) throw new NotFoundError('Ese ítem no existe.');
  if (item.age_check === 'NONE') throw new ValidationError('Ese ítem no requiere verificación de edad.');
  await repo.setItemAgeCheck(tenantId, itemId, result, pool);
  await writeAudit({ req: actor.req, tenantId, branchId: order.branch_id, entityType: 'order_item', entityId: itemId, action: 'age_check', after: { result } });
  return getOrder(tenantId, orderId);
}

async function completeOrder(tenantId, orderId, actor) {
  const order = await repo.findOrder(tenantId, orderId);
  if (!order) throw new NotFoundError('Ese pedido no existe.');
  if (order.status === 'COMPLETED') return getOrder(tenantId, orderId);
  assertTransition(order.status, 'COMPLETED');
  await repo.recordEvent(tenantId, orderId, order.status, 'COMPLETED', { actorKind: actor.kind, actorId: actor.actorId });
  await repo.updateOrderStatus(tenantId, orderId, 'COMPLETED', { completed_at: 'now' });
  return getOrder(tenantId, orderId);
}

// ============================================================ listados
async function listOrders(tenantId, filters) {
  const orders = await repo.listOrders(tenantId, filters);
  return Promise.all(orders.map(async (o) => ({ ...o, items: await repo.listItems(tenantId, o.id) })));
}

async function getOrderEvents(tenantId, orderId) {
  const o = await repo.findOrder(tenantId, orderId);
  if (!o) throw new NotFoundError('Ese pedido no existe.');
  return repo.listEvents(tenantId, orderId);
}

// -------- vista del comensal
async function listGuestOrders(scope) {
  const { tenantId, sessionId, participantId } = scope;
  const all = await repo.listOrders(tenantId, { sessionId });
  const mine = [];
  const othersByParticipant = new Map();
  for (const o of all) {
    if (o.participant_id === participantId) {
      mine.push({ ...o, items: await repo.listItems(tenantId, o.id) });
    } else if (o.status !== 'DRAFT' && o.status !== 'CANCELLED') {
      const k = o.participant_id;
      if (!othersByParticipant.has(k)) othersByParticipant.set(k, { orderCount: 0, total: 0 });
      const agg = othersByParticipant.get(k);
      agg.orderCount++;
      agg.total = fromCents(toCents(String(agg.total)) + toCents(o.total));
    }
  }
  const drafts = await repo.draftOrdersInSession(tenantId, sessionId);
  const someoneElseOrdering = drafts.filter((d) => d.participant_id !== participantId);

  const [[session]] = await pool.query(
    `SELECT total_amount, currency, order_mode, status FROM table_sessions WHERE tenant_id = :tenantId AND id = :sessionId`,
    { tenantId, sessionId }
  );
  return {
    mine,
    tableTotal: session ? session.total_amount : '0.00',
    currency: session ? session.currency : 'ARS',
    orderMode: session ? session.order_mode : 'INDIVIDUAL',
    othersSummary: [...othersByParticipant.values()],
    someoneElseOrdering: someoneElseOrdering.map((d) => ({ name: d.display_name || 'Alguien' })),
  };
}

async function sessionPublicId(sessionId) {
  const [[row]] = await pool.query(`SELECT public_id FROM table_sessions WHERE id = :id`, { id: sessionId });
  return row ? row.public_id : null;
}

module.exports = {
  createOrder, getOrder, addItem, updateItem, removeItem, submitOrder,
  cancelOrder, setPriority, verifyAge, completeOrder,
  listOrders, getOrderEvents, listGuestOrders,
  // seams para la Fase 5
  _validateAndReserveStock: validateAndReserveStock,
};
