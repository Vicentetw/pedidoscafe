const pool = require('../../db');

// Repo promociones: definición, reglas (condiciones AND entre sí),
// canjes por pedido. tenantId primero; todo WHERE lo lleva.

const PROMO_COLS = `id, tenant_id, code, name, type, value, priority, stackable, active_from, active_to, status, created_at`;

async function createPromotion(tenantId, d, conn = pool) {
  const [r] = await conn.query(
    `INSERT INTO promotions (tenant_id, code, name, type, value, priority, stackable, active_from, active_to, status)
     VALUES (:tenantId, :code, :name, :type, :value, :priority, :stackable, :activeFrom, :activeTo, :status)`,
    {
      tenantId, code: d.code, name: d.name, type: d.type, value: d.value ?? null, priority: d.priority ?? 0,
      stackable: d.stackable ? 1 : 0, activeFrom: d.activeFrom ?? null, activeTo: d.activeTo ?? null, status: d.status ?? 'ACTIVE',
    }
  );
  return r.insertId;
}
async function listPromotions(tenantId, { status = null } = {}, conn = pool) {
  const where = ['tenant_id = :tenantId'];
  const params = { tenantId };
  if (status) { where.push('status = :status'); params.status = status; }
  const [rows] = await conn.query(`SELECT ${PROMO_COLS} FROM promotions WHERE ${where.join(' AND ')} ORDER BY priority, code`, params);
  return rows;
}
async function findPromotion(tenantId, id, conn = pool) {
  const [[row]] = await conn.query(`SELECT ${PROMO_COLS} FROM promotions WHERE tenant_id = :tenantId AND id = :id`, { tenantId, id });
  return row || null;
}
async function findActiveByCode(tenantId, code, conn = pool) {
  const [[row]] = await conn.query(`SELECT ${PROMO_COLS} FROM promotions WHERE tenant_id = :tenantId AND code = :code AND status = 'ACTIVE'`, { tenantId, code });
  return row || null;
}
async function setStatus(tenantId, id, status, conn = pool) {
  await conn.query(`UPDATE promotions SET status = :status WHERE tenant_id = :tenantId AND id = :id`, { tenantId, id, status });
}

// -------- reglas
async function createRule(tenantId, promotionId, d, conn = pool) {
  const [r] = await conn.query(
    `INSERT INTO promotion_rules (tenant_id, promotion_id, condition_type, operator, value) VALUES (:tenantId, :promotionId, :conditionType, :operator, :value)`,
    { tenantId, promotionId, conditionType: d.conditionType, operator: d.operator ?? 'EQ', value: JSON.stringify(d.value) }
  );
  return r.insertId;
}
async function listRulesForPromotion(tenantId, promotionId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT id, condition_type, operator, value FROM promotion_rules WHERE tenant_id = :tenantId AND promotion_id = :promotionId`,
    { tenantId, promotionId }
  );
  return rows;
}

// -------- canjes
async function createRedemption(tenantId, d, conn) {
  const [r] = await conn.query(
    `INSERT INTO promotion_redemptions (tenant_id, promotion_id, order_id, amount_discounted, code_snapshot, type_snapshot, value_snapshot, priority_snapshot, stackable_snapshot)
     VALUES (:tenantId, :promotionId, :orderId, :amount, :code, :type, :value, :priority, :stackable)`,
    {
      tenantId, promotionId: d.promotionId, orderId: d.orderId, amount: d.amount, code: d.code, type: d.type,
      value: d.value ?? null, priority: d.priority ?? 0, stackable: d.stackable ? 1 : 0,
    }
  );
  return r.insertId;
}
async function listRedemptionsForOrder(tenantId, orderId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT id, promotion_id, amount_discounted, code_snapshot, type_snapshot, value_snapshot, priority_snapshot, stackable_snapshot
       FROM promotion_redemptions WHERE tenant_id = :tenantId AND order_id = :orderId ORDER BY priority_snapshot`,
    { tenantId, orderId }
  );
  return rows;
}
async function deleteRedemption(tenantId, orderId, promotionId, conn) {
  const [r] = await conn.query(
    `DELETE FROM promotion_redemptions WHERE tenant_id = :tenantId AND order_id = :orderId AND promotion_id = :promotionId`,
    { tenantId, orderId, promotionId }
  );
  return r.affectedRows > 0;
}
async function updateRedemptionAmount(tenantId, id, amount, conn) {
  await conn.query(`UPDATE promotion_redemptions SET amount_discounted = :amount WHERE tenant_id = :tenantId AND id = :id`, { tenantId, id, amount });
}

// Categorías de un set de productos — para la condición CATEGORY sin
// depender de volver a resolver cada ítem contra el catálogo completo.
async function categoriesForProducts(tenantId, productIds, conn = pool) {
  if (!productIds.length) return [];
  const [rows] = await conn.query(
    `SELECT DISTINCT category_id FROM products WHERE tenant_id = :tenantId AND id IN (:ids)`,
    { tenantId, ids: productIds }
  );
  return rows.map((r) => r.category_id);
}

module.exports = {
  createPromotion, listPromotions, findPromotion, findActiveByCode, setStatus,
  createRule, listRulesForPromotion,
  createRedemption, listRedemptionsForOrder, deleteRedemption, updateRedemptionAmount,
  categoriesForProducts,
};
