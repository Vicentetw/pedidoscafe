const { ulid } = require('ulid');
const pool = require('../../db');

// Repo de orders / order_items / order_item_modifiers / order_events.
// tenantId primero; todo WHERE lo lleva.

const ORDER_COLS = `id, public_id, tenant_id, branch_id, session_id, participant_id, customer_id, channel,
  status, payment_status, priority, subtotal, discount_total, tax_total, tip_total, total, currency,
  note, created_by_kind, created_by, ordered_at, ready_at, delivered_at, completed_at, cancelled_at, cancel_reason, created_at`;

async function createOrder(tenantId, d, conn = pool) {
  const publicId = ulid();
  const [r] = await conn.query(
    `INSERT INTO orders (public_id, tenant_id, branch_id, session_id, participant_id, customer_id, channel, status,
        currency, note, created_by_kind, created_by)
     VALUES (:publicId, :tenantId, :branchId, :sessionId, :participantId, :customerId, :channel, 'DRAFT',
        :currency, :note, :createdByKind, :createdBy)`,
    {
      publicId, tenantId, branchId: d.branchId, sessionId: d.sessionId ?? null,
      participantId: d.participantId ?? null, customerId: d.customerId ?? null, channel: d.channel, currency: d.currency ?? 'ARS',
      note: d.note ?? null, createdByKind: d.createdByKind, createdBy: d.createdBy ?? null,
    }
  );
  return { id: r.insertId, publicId };
}

async function findOrder(tenantId, id, conn = pool) {
  const [[row]] = await conn.query(`SELECT ${ORDER_COLS} FROM orders WHERE tenant_id = :tenantId AND id = :id`, { tenantId, id });
  return row || null;
}
async function findOrderByPublicId(tenantId, publicId, conn = pool) {
  const [[row]] = await conn.query(`SELECT ${ORDER_COLS} FROM orders WHERE tenant_id = :tenantId AND public_id = :publicId`, { tenantId, publicId });
  return row || null;
}
// Sólo para rutas públicas de seguimiento (sin sesión de staff todavía
// resuelta): el public_id (ULID) ES la credencial, igual que un token de QR
// — se busca sin tenantId porque el tenant recién se conoce a partir de acá.
async function findByPublicIdAny(publicId, conn = pool) {
  const [[row]] = await conn.query(`SELECT ${ORDER_COLS} FROM orders WHERE public_id = :publicId`, { publicId });
  return row || null;
}
async function lockOrder(tenantId, id, conn) {
  const [[row]] = await conn.query(`SELECT ${ORDER_COLS} FROM orders WHERE tenant_id = :tenantId AND id = :id FOR UPDATE`, { tenantId, id });
  return row || null;
}

async function listOrders(tenantId, { branchId, sessionId, status, participantId, limit = 100 } = {}, conn = pool) {
  const where = ['o.tenant_id = :tenantId'];
  const p = { tenantId, limit: Number(limit) };
  if (branchId) { where.push('o.branch_id = :branchId'); p.branchId = branchId; }
  if (sessionId) { where.push('o.session_id = :sessionId'); p.sessionId = sessionId; }
  if (participantId) { where.push('o.participant_id = :participantId'); p.participantId = participantId; }
  if (status) { where.push('o.status = :status'); p.status = status; }
  const [rows] = await conn.query(
    `SELECT o.${ORDER_COLS.replace(/\s+/g, ' ')} FROM orders o WHERE ${where.join(' AND ')} ORDER BY o.created_at DESC LIMIT :limit`,
    p
  );
  return rows;
}

async function updateOrderStatus(tenantId, id, toStatus, stamps = {}, conn = pool) {
  const set = ['status = :toStatus'];
  const p = { tenantId, id, toStatus };
  for (const col of ['ordered_at', 'accepted_at', 'started_at', 'ready_at', 'delivered_at', 'completed_at', 'cancelled_at']) {
    if (stamps[col] === 'now') set.push(`${col} = CURRENT_TIMESTAMP`);
  }
  if (stamps.cancel_reason !== undefined) { set.push('cancel_reason = :cancelReason'); p.cancelReason = stamps.cancel_reason; }
  await conn.query(`UPDATE orders SET ${set.join(', ')} WHERE tenant_id = :tenantId AND id = :id`, p);
}
async function updateOrderPriority(tenantId, id, priority, conn = pool) {
  await conn.query(`UPDATE orders SET priority = :priority WHERE tenant_id = :tenantId AND id = :id`, { tenantId, id, priority });
}
async function setOrderPaymentStatus(tenantId, id, paymentStatus, conn = pool) {
  await conn.query(`UPDATE orders SET payment_status = :paymentStatus WHERE tenant_id = :tenantId AND id = :id`, { tenantId, id, paymentStatus });
}
// Total pedido (en operación) por participante de una sesión — para el
// saldo individual (ARQUITECTURA_V1 §10).
async function totalsByParticipant(tenantId, sessionId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT participant_id, SUM(total) AS total FROM orders
      WHERE tenant_id = :tenantId AND session_id = :sessionId
        AND status IN ('CONFIRMED','QUEUED','PREPARING','READY','DELIVERED','COMPLETED')
        AND participant_id IS NOT NULL
      GROUP BY participant_id`,
    { tenantId, sessionId }
  );
  return new Map(rows.map((r) => [r.participant_id, Number(r.total)]));
}
async function setOrderTotals(tenantId, id, t, conn = pool) {
  await conn.query(
    `UPDATE orders SET subtotal = :subtotal, discount_total = :discount, tax_total = :tax,
        tip_total = :tip, total = :total WHERE tenant_id = :tenantId AND id = :id`,
    { tenantId, id, subtotal: t.subtotal, discount: t.discount ?? 0, tax: t.tax ?? 0, tip: t.tip ?? 0, total: t.total }
  );
}
async function recomputeSessionTotal(tenantId, sessionId, conn = pool) {
  // total de la mesa = suma de totales de sus orders "en operación" o pagables.
  await conn.query(
    `UPDATE table_sessions s
        SET s.total_amount = COALESCE((
          SELECT SUM(o.total) FROM orders o
           WHERE o.session_id = s.id
             AND o.status IN ('CONFIRMED','QUEUED','PREPARING','READY','DELIVERED','COMPLETED')
        ), 0)
      WHERE s.tenant_id = :tenantId AND s.id = :sessionId`,
    { tenantId, sessionId }
  );
}

// -------- items
async function addItem(tenantId, orderId, d, conn = pool) {
  const [r] = await conn.query(
    `INSERT INTO order_items (tenant_id, order_id, product_id, variant_id, participant_id,
        name_snapshot, variant_snapshot, unit_price, qty, modifiers_total, line_total, age_check, note)
     VALUES (:tenantId, :orderId, :productId, :variantId, :participantId,
        :nameSnapshot, :variantSnapshot, :unitPrice, :qty, :modifiersTotal, :lineTotal, :ageCheck, :note)`,
    {
      tenantId, orderId, productId: d.productId, variantId: d.variantId ?? null, participantId: d.participantId ?? null,
      nameSnapshot: d.nameSnapshot, variantSnapshot: d.variantSnapshot ?? null, unitPrice: d.unitPrice, qty: d.qty,
      modifiersTotal: d.modifiersTotal, lineTotal: d.lineTotal,
      ageCheck: d.requiresAge ? 'REQUIRED' : 'NONE', note: d.note ?? null,
    }
  );
  if (d.modifiers && d.modifiers.length) {
    await conn.query(
      `INSERT INTO order_item_modifiers (tenant_id, order_item_id, modifier_id, name_snapshot, price_delta) VALUES ?`,
      [d.modifiers.map((m) => [tenantId, r.insertId, m.modifierId ?? null, m.nameSnapshot, m.priceDelta])]
    );
  }
  return r.insertId;
}
async function findItem(tenantId, orderId, itemId, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT id, order_id, product_id, variant_id, participant_id, name_snapshot, variant_snapshot,
            unit_price, qty, modifiers_total, line_total, station_id, kitchen_status, age_check, note
       FROM order_items WHERE tenant_id = :tenantId AND order_id = :orderId AND id = :itemId`,
    { tenantId, orderId, itemId }
  );
  return row || null;
}
async function listItems(tenantId, orderId, conn = pool) {
  const [items] = await conn.query(
    `SELECT id, order_id, product_id, variant_id, participant_id, name_snapshot, variant_snapshot,
            unit_price, qty, modifiers_total, line_total, station_id, kitchen_status, age_check, note
       FROM order_items WHERE tenant_id = :tenantId AND order_id = :orderId ORDER BY id`,
    { tenantId, orderId }
  );
  if (!items.length) return [];
  const [mods] = await conn.query(
    `SELECT oim.order_item_id, oim.modifier_id, oim.name_snapshot, oim.price_delta
       FROM order_item_modifiers oim
       JOIN order_items oi ON oi.id = oim.order_item_id
      WHERE oi.tenant_id = :tenantId AND oi.order_id = :orderId`,
    { tenantId, orderId }
  );
  const byItem = new Map();
  for (const m of mods) {
    if (!byItem.has(m.order_item_id)) byItem.set(m.order_item_id, []);
    byItem.get(m.order_item_id).push({ modifierId: m.modifier_id, name: m.name_snapshot, priceDelta: m.price_delta });
  }
  return items.map((i) => ({ ...i, modifiers: byItem.get(i.id) || [] }));
}
async function updateItemQty(tenantId, orderId, itemId, qty, unitPrice, modifiersTotal, lineTotal, conn = pool) {
  await conn.query(
    `UPDATE order_items SET qty = :qty, line_total = :lineTotal
      WHERE tenant_id = :tenantId AND order_id = :orderId AND id = :itemId`,
    { tenantId, orderId, itemId, qty, lineTotal }
  );
}
async function deleteItem(tenantId, orderId, itemId, conn = pool) {
  await conn.query(`DELETE FROM order_items WHERE tenant_id = :tenantId AND order_id = :orderId AND id = :itemId`, { tenantId, orderId, itemId });
}
async function setItemStation(tenantId, itemId, stationId, conn = pool) {
  await conn.query(`UPDATE order_items SET station_id = :stationId WHERE tenant_id = :tenantId AND id = :itemId`, { tenantId, itemId, stationId: stationId ?? null });
}
async function setItemKitchenStatus(tenantId, orderId, status, conn = pool) {
  await conn.query(`UPDATE order_items SET kitchen_status = :status WHERE tenant_id = :tenantId AND order_id = :orderId`, { tenantId, orderId, status });
}
async function setItemAgeCheck(tenantId, itemId, result, conn = pool) {
  await conn.query(`UPDATE order_items SET age_check = :result WHERE tenant_id = :tenantId AND id = :itemId`, { tenantId, itemId, result });
}
async function countUnresolvedAgeChecks(tenantId, orderId, conn = pool) {
  const [[{ n }]] = await conn.query(
    `SELECT COUNT(*) n FROM order_items WHERE tenant_id = :tenantId AND order_id = :orderId AND age_check = 'REQUIRED'`,
    { tenantId, orderId }
  );
  return n;
}

// -------- eventos de la máquina de estados
async function recordEvent(tenantId, orderId, fromStatus, toStatus, { actorKind = 'system', actorId = null, reason = null } = {}, conn = pool) {
  await conn.query(
    `INSERT INTO order_events (tenant_id, order_id, from_status, to_status, actor_kind, actor_id, reason)
     VALUES (:tenantId, :orderId, :fromStatus, :toStatus, :actorKind, :actorId, :reason)`,
    { tenantId, orderId, fromStatus, toStatus, actorKind, actorId, reason }
  );
}
async function listEvents(tenantId, orderId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT from_status, to_status, actor_kind, actor_id, reason, created_at
       FROM order_events WHERE tenant_id = :tenantId AND order_id = :orderId ORDER BY created_at`,
    { tenantId, orderId }
  );
  return rows;
}

// -------- "otra persona pidiendo" (§9): borradores abiertos en una sesión
async function draftOrdersInSession(tenantId, sessionId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT o.id, o.participant_id, p.display_name
       FROM orders o LEFT JOIN session_participants p ON p.id = o.participant_id
      WHERE o.tenant_id = :tenantId AND o.session_id = :sessionId AND o.status = 'DRAFT'`,
    { tenantId, sessionId }
  );
  return rows;
}

module.exports = {
  createOrder, findOrder, findOrderByPublicId, findByPublicIdAny, lockOrder, listOrders,
  updateOrderStatus, updateOrderPriority, setOrderPaymentStatus, totalsByParticipant, setOrderTotals, recomputeSessionTotal,
  addItem, findItem, listItems, updateItemQty, deleteItem,
  setItemStation, setItemKitchenStatus, setItemAgeCheck, countUnresolvedAgeChecks,
  recordEvent, listEvents, draftOrdersInSession,
};
