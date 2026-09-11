const pool = require('../../db');

// Repo de estaciones de cocina, ruteo y tickets (KDS). tenantId primero.

// -------- estaciones
async function listStations(tenantId, branchId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT id, tenant_id, branch_id, code, name, type, is_default, sort_order
       FROM kitchen_stations
      WHERE tenant_id = :tenantId AND branch_id = :branchId AND deleted_at IS NULL
      ORDER BY sort_order, name`,
    { tenantId, branchId }
  );
  return rows;
}
async function findStation(tenantId, id, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT id, tenant_id, branch_id, code, name, type, is_default FROM kitchen_stations
      WHERE tenant_id = :tenantId AND id = :id AND deleted_at IS NULL`,
    { tenantId, id }
  );
  return row || null;
}
async function findStationByCode(tenantId, branchId, code, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT id FROM kitchen_stations WHERE tenant_id = :tenantId AND branch_id = :branchId AND code = :code AND deleted_at IS NULL`,
    { tenantId, branchId, code }
  );
  return row || null;
}
async function createStation(tenantId, d, conn = pool) {
  if (d.isDefault) {
    await conn.query(`UPDATE kitchen_stations SET is_default = 0 WHERE tenant_id = :tenantId AND branch_id = :branchId`, { tenantId, branchId: d.branchId });
  }
  const [r] = await conn.query(
    `INSERT INTO kitchen_stations (tenant_id, branch_id, code, name, type, is_default, sort_order)
     VALUES (:tenantId, :branchId, :code, :name, :type, :isDefault, :sortOrder)`,
    { tenantId, branchId: d.branchId, code: d.code, name: d.name, type: d.type ?? 'KITCHEN', isDefault: d.isDefault ? 1 : 0, sortOrder: d.sortOrder ?? 0 }
  );
  return r.insertId;
}
async function deleteStation(tenantId, id, conn = pool) {
  await conn.query(`UPDATE kitchen_stations SET deleted_at = CURRENT_TIMESTAMP WHERE tenant_id = :tenantId AND id = :id`, { tenantId, id });
}

// -------- ruteo
async function listRouting(tenantId, branchId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT r.id, r.product_id, r.category_id, r.station_id, s.name AS station_name
       FROM product_station_routing r JOIN kitchen_stations s ON s.id = r.station_id
      WHERE r.tenant_id = :tenantId AND r.branch_id = :branchId`,
    { tenantId, branchId }
  );
  return rows;
}
async function upsertRouting(tenantId, branchId, { productId = null, categoryId = null, stationId }, conn = pool) {
  if (productId != null) {
    await conn.query(
      `INSERT INTO product_station_routing (tenant_id, branch_id, product_id, station_id)
       VALUES (:tenantId, :branchId, :productId, :stationId)
       ON DUPLICATE KEY UPDATE station_id = VALUES(station_id)`,
      { tenantId, branchId, productId, stationId }
    );
  } else if (categoryId != null) {
    await conn.query(
      `INSERT INTO product_station_routing (tenant_id, branch_id, category_id, station_id)
       VALUES (:tenantId, :branchId, :categoryId, :stationId)
       ON DUPLICATE KEY UPDATE station_id = VALUES(station_id)`,
      { tenantId, branchId, categoryId, stationId }
    );
  }
}
async function deleteRouting(tenantId, id, conn = pool) {
  await conn.query(`DELETE FROM product_station_routing WHERE tenant_id = :tenantId AND id = :id`, { tenantId, id });
}

// Resuelve la estación de un producto: regla de producto -> regla de
// categoría -> estación default de la sucursal -> primera estación ->
// null (sucursal sin estaciones).
async function resolveStationFor(tenantId, branchId, productId, categoryId, conn = pool) {
  const [[byProduct]] = await conn.query(
    `SELECT station_id FROM product_station_routing WHERE tenant_id = :tenantId AND branch_id = :branchId AND product_id = :productId`,
    { tenantId, branchId, productId }
  );
  if (byProduct) return byProduct.station_id;

  // Si no vino la categoría, se resuelve desde el producto.
  if (categoryId == null) {
    const [[p]] = await conn.query(`SELECT category_id FROM products WHERE id = :productId`, { productId });
    categoryId = p ? p.category_id : null;
  }
  if (categoryId != null) {
    const [[byCat]] = await conn.query(
      `SELECT station_id FROM product_station_routing WHERE tenant_id = :tenantId AND branch_id = :branchId AND category_id = :categoryId`,
      { tenantId, branchId, categoryId }
    );
    if (byCat) return byCat.station_id;
  }
  const [[def]] = await conn.query(
    `SELECT id FROM kitchen_stations WHERE tenant_id = :tenantId AND branch_id = :branchId AND deleted_at IS NULL
      ORDER BY is_default DESC, sort_order, id LIMIT 1`,
    { tenantId, branchId }
  );
  return def ? def.id : null;
}

// -------- tickets
async function nextTicketNo(tenantId, branchId, conn = pool) {
  await conn.query(
    `INSERT INTO kitchen_ticket_counters (tenant_id, branch_id, day, last_no)
     VALUES (:tenantId, :branchId, CURRENT_DATE, 1)
     ON DUPLICATE KEY UPDATE last_no = last_no + 1`,
    { tenantId, branchId }
  );
  const [[row]] = await conn.query(
    `SELECT last_no FROM kitchen_ticket_counters WHERE tenant_id = :tenantId AND branch_id = :branchId AND day = CURRENT_DATE`,
    { tenantId, branchId }
  );
  return row.last_no;
}
async function createTicket(tenantId, branchId, orderId, stationId, sequenceNo, items, conn = pool) {
  const [r] = await conn.query(
    `INSERT INTO kitchen_tickets (tenant_id, branch_id, order_id, station_id, status, sequence_no)
     VALUES (:tenantId, :branchId, :orderId, :stationId, 'QUEUED', :sequenceNo)`,
    { tenantId, branchId, orderId, stationId: stationId ?? null, sequenceNo }
  );
  if (items.length) {
    await conn.query(
      `INSERT INTO kitchen_ticket_items (ticket_id, order_item_id, qty, status) VALUES ?`,
      [items.map((it) => [r.insertId, it.id, it.qty, 'QUEUED'])]
    );
  }
  return r.insertId;
}
async function listBoard(tenantId, branchId, { stationId, status } = {}, conn = pool) {
  const where = ['t.tenant_id = :tenantId', 't.branch_id = :branchId'];
  const p = { tenantId, branchId };
  if (stationId) { where.push('t.station_id = :stationId'); p.stationId = stationId; }
  if (status) { where.push('t.status = :status'); p.status = status; }
  else where.push("t.status IN ('QUEUED','PREPARING','READY')");
  const [tickets] = await conn.query(
    `SELECT t.id, t.order_id, t.station_id, t.status, t.sequence_no, t.created_at, t.started_at, t.ready_at,
            o.public_id AS order_public_id, o.channel, o.priority, o.note AS order_note,
            st.name AS station_name
       FROM kitchen_tickets t
       JOIN orders o ON o.id = t.order_id
       LEFT JOIN kitchen_stations st ON st.id = t.station_id
      WHERE ${where.join(' AND ')}
      ORDER BY FIELD(o.priority,'LATE','VIP','URGENT','NORMAL') DESC, t.created_at`,
    p
  );
  if (!tickets.length) return [];
  const ids = tickets.map((t) => t.id);
  const [tItems] = await conn.query(
    `SELECT kti.ticket_id, kti.qty, kti.status, oi.name_snapshot, oi.variant_snapshot, oi.note
       FROM kitchen_ticket_items kti JOIN order_items oi ON oi.id = kti.order_item_id
      WHERE kti.ticket_id IN (${ids.map(() => '?').join(',')})`,
    ids
  );
  const byTicket = new Map();
  for (const it of tItems) {
    if (!byTicket.has(it.ticket_id)) byTicket.set(it.ticket_id, []);
    byTicket.get(it.ticket_id).push({ name: it.name_snapshot, variant: it.variant_snapshot, qty: it.qty, note: it.note, status: it.status });
  }
  return tickets.map((t) => ({ ...t, items: byTicket.get(t.id) || [] }));
}
async function findTicket(tenantId, id, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT id, tenant_id, branch_id, order_id, station_id, status FROM kitchen_tickets WHERE tenant_id = :tenantId AND id = :id`,
    { tenantId, id }
  );
  return row || null;
}
async function setTicketStatus(tenantId, id, status, stamp, conn = pool) {
  const set = ['status = :status'];
  if (stamp === 'started') set.push('started_at = CURRENT_TIMESTAMP');
  if (stamp === 'ready') set.push('ready_at = CURRENT_TIMESTAMP');
  if (stamp === 'delivered') set.push('delivered_at = CURRENT_TIMESTAMP');
  await conn.query(`UPDATE kitchen_tickets SET ${set.join(', ')} WHERE tenant_id = :tenantId AND id = :id`, { tenantId, id, status });
  await conn.query(`UPDATE kitchen_ticket_items SET status = :status WHERE ticket_id = :id`, { id, status });
}
async function ticketsForOrder(tenantId, orderId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT id, station_id, status FROM kitchen_tickets WHERE tenant_id = :tenantId AND order_id = :orderId`,
    { tenantId, orderId }
  );
  return rows;
}

module.exports = {
  listStations, findStation, findStationByCode, createStation, deleteStation,
  listRouting, upsertRouting, deleteRouting, resolveStationFor,
  nextTicketNo, createTicket, listBoard, findTicket, setTicketStatus, ticketsForOrder,
};
