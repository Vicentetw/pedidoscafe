const pool = require('../../db');

// Repo de stock. tenantId primero; todo WHERE lo lleva. La reserva
// pesimista vive en stock.service.js (usa lockStockRows de acá).

// -------- ingredientes
async function listIngredients(tenantId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT id, code, name, unit, is_tracked FROM ingredients
      WHERE tenant_id = :tenantId AND deleted_at IS NULL ORDER BY name`,
    { tenantId }
  );
  return rows;
}
async function findIngredient(tenantId, id, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT id, code, name, unit, is_tracked FROM ingredients WHERE tenant_id = :tenantId AND id = :id AND deleted_at IS NULL`,
    { tenantId, id }
  );
  return row || null;
}
async function findIngredientByCode(tenantId, code, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT id, name, is_tracked FROM ingredients WHERE tenant_id = :tenantId AND code = :code AND deleted_at IS NULL`,
    { tenantId, code }
  );
  return row || null;
}
async function createIngredient(tenantId, d, conn = pool) {
  const [r] = await conn.query(
    `INSERT INTO ingredients (tenant_id, code, name, unit, is_tracked) VALUES (:tenantId, :code, :name, :unit, :isTracked)`,
    { tenantId, code: d.code, name: d.name, unit: d.unit ?? 'unit', isTracked: d.isTracked === false ? 0 : 1 }
  );
  return r.insertId;
}
async function updateIngredient(tenantId, id, patch, conn = pool) {
  const f = [];
  const p = { tenantId, id };
  for (const k of ['name', 'unit']) if (patch[k] !== undefined) { f.push(`${k} = :${k}`); p[k] = patch[k]; }
  if (patch.isTracked !== undefined) { f.push('is_tracked = :isTracked'); p.isTracked = patch.isTracked ? 1 : 0; }
  if (f.length) await conn.query(`UPDATE ingredients SET ${f.join(', ')} WHERE tenant_id = :tenantId AND id = :id`, p);
}

// -------- recetas
async function getRecipe(tenantId, productId, variantId, conn = pool) {
  const [[recipe]] = await conn.query(
    `SELECT id, yield_qty FROM recipes
      WHERE tenant_id = :tenantId AND product_id = :productId
        AND ((variant_id IS NULL AND :variantId IS NULL) OR variant_id = :variantId)`,
    { tenantId, productId, variantId: variantId ?? null }
  );
  if (!recipe) return null;
  const [items] = await conn.query(
    `SELECT ri.ingredient_id, ri.qty, i.code, i.name, i.is_tracked
       FROM recipe_items ri JOIN ingredients i ON i.id = ri.ingredient_id
      WHERE ri.recipe_id = :recipeId`,
    { recipeId: recipe.id }
  );
  return { id: recipe.id, yieldQty: Number(recipe.yield_qty), items };
}
// Receta efectiva: la de la variante, si no la base del producto.
async function resolveRecipe(tenantId, productId, variantId, conn = pool) {
  if (variantId != null) {
    const r = await getRecipe(tenantId, productId, variantId, conn);
    if (r) return r;
  }
  return getRecipe(tenantId, productId, null, conn);
}
async function upsertRecipe(tenantId, productId, variantId, yieldQty, items, conn = pool) {
  const [[existing]] = await conn.query(
    `SELECT id FROM recipes WHERE tenant_id = :tenantId AND product_id = :productId
       AND ((variant_id IS NULL AND :variantId IS NULL) OR variant_id = :variantId)`,
    { tenantId, productId, variantId: variantId ?? null }
  );
  let recipeId;
  if (existing) {
    recipeId = existing.id;
    await conn.query(`UPDATE recipes SET yield_qty = :yieldQty WHERE id = :id`, { yieldQty, id: recipeId });
    await conn.query(`DELETE FROM recipe_items WHERE recipe_id = :id`, { id: recipeId });
  } else {
    const [r] = await conn.query(
      `INSERT INTO recipes (tenant_id, product_id, variant_id, yield_qty) VALUES (:tenantId, :productId, :variantId, :yieldQty)`,
      { tenantId, productId, variantId: variantId ?? null, yieldQty }
    );
    recipeId = r.insertId;
  }
  if (items.length) {
    await conn.query(
      `INSERT INTO recipe_items (tenant_id, recipe_id, ingredient_id, qty) VALUES ?`,
      [items.map((it) => [tenantId, recipeId, it.ingredientId, it.qty])]
    );
  }
  return recipeId;
}

// -------- stock
async function listStock(tenantId, branchId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT s.ingredient_id, i.code, i.name, i.unit, i.is_tracked,
            s.qty_on_hand, s.qty_reserved,
            (s.qty_on_hand - s.qty_reserved) AS qty_available, s.reorder_point
       FROM stock s JOIN ingredients i ON i.id = s.ingredient_id
      WHERE s.tenant_id = :tenantId AND s.branch_id = :branchId AND i.deleted_at IS NULL
      ORDER BY i.name`,
    { tenantId, branchId }
  );
  return rows;
}
async function ensureStockRow(tenantId, branchId, ingredientId, conn = pool) {
  await conn.query(
    `INSERT INTO stock (tenant_id, branch_id, ingredient_id, qty_on_hand, qty_reserved)
     VALUES (:tenantId, :branchId, :ingredientId, 0, 0)
     ON DUPLICATE KEY UPDATE ingredient_id = ingredient_id`,
    { tenantId, branchId, ingredientId }
  );
}
// Lock pesimista de las filas de stock, SIEMPRE en orden por ingredient_id
// para que dos submits concurrentes no se traben en deadlock (§8/§12).
async function lockStockRows(tenantId, branchId, ingredientIds, conn) {
  if (!ingredientIds.length) return [];
  const ph = ingredientIds.map(() => '?').join(',');
  const [rows] = await conn.query(
    `SELECT s.id, s.ingredient_id, s.qty_on_hand, s.qty_reserved, i.name, i.is_tracked
       FROM stock s JOIN ingredients i ON i.id = s.ingredient_id
      WHERE s.tenant_id = ? AND s.branch_id = ? AND s.ingredient_id IN (${ph})
      ORDER BY s.ingredient_id
      FOR UPDATE`,
    [tenantId, branchId, ...ingredientIds]
  );
  return rows;
}
async function adjustStockQty(tenantId, branchId, ingredientId, { onHandDelta = 0, reservedDelta = 0 }, conn = pool) {
  await conn.query(
    `UPDATE stock SET qty_on_hand = qty_on_hand + :onHandDelta, qty_reserved = qty_reserved + :reservedDelta
      WHERE tenant_id = :tenantId AND branch_id = :branchId AND ingredient_id = :ingredientId`,
    { tenantId, branchId, ingredientId, onHandDelta, reservedDelta }
  );
}
async function setReorderPoint(tenantId, branchId, ingredientId, value, conn = pool) {
  await ensureStockRow(tenantId, branchId, ingredientId, conn);
  await conn.query(
    `UPDATE stock SET reorder_point = :value WHERE tenant_id = :tenantId AND branch_id = :branchId AND ingredient_id = :ingredientId`,
    { tenantId, branchId, ingredientId, value }
  );
}

// -------- movimientos (ledger)
async function recordMovement(tenantId, branchId, ingredientId, type, qty, ref, conn = pool) {
  await conn.query(
    `INSERT INTO stock_movements (tenant_id, branch_id, ingredient_id, type, qty, ref_type, ref_id, reason, actor_user_id)
     VALUES (:tenantId, :branchId, :ingredientId, :type, :qty, :refType, :refId, :reason, :actorUserId)`,
    {
      tenantId, branchId, ingredientId, type, qty,
      refType: ref?.refType ?? null, refId: ref?.refId ?? null, reason: ref?.reason ?? null, actorUserId: ref?.actorUserId ?? null,
    }
  );
}
async function listMovements(tenantId, branchId, { ingredientId, limit = 200 } = {}, conn = pool) {
  const [rows] = await conn.query(
    `SELECT m.ingredient_id, i.name AS ingredient_name, m.type, m.qty, m.ref_type, m.ref_id, m.reason, m.created_at
       FROM stock_movements m JOIN ingredients i ON i.id = m.ingredient_id
      WHERE m.tenant_id = :tenantId AND m.branch_id = :branchId
        ${ingredientId ? 'AND m.ingredient_id = :ingredientId' : ''}
      ORDER BY m.created_at DESC LIMIT :limit`,
    { tenantId, branchId, ingredientId, limit: Number(limit) }
  );
  return rows;
}

// -------- reservas
async function insertReservation(tenantId, branchId, orderId, ingredientId, qty, expiresAt, conn = pool) {
  await conn.query(
    `INSERT INTO stock_reservations (tenant_id, branch_id, order_id, ingredient_id, qty, status, expires_at)
     VALUES (:tenantId, :branchId, :orderId, :ingredientId, :qty, 'ACTIVE', :expiresAt)`,
    { tenantId, branchId, orderId, ingredientId, qty, expiresAt: expiresAt ?? null }
  );
}
async function activeReservationsForOrder(tenantId, orderId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT id, branch_id, ingredient_id, qty FROM stock_reservations
      WHERE tenant_id = :tenantId AND order_id = :orderId AND status = 'ACTIVE'`,
    { tenantId, orderId }
  );
  return rows;
}
async function setReservationStatus(ids, status, conn = pool) {
  if (!ids.length) return;
  await conn.query(`UPDATE stock_reservations SET status = ? WHERE id IN (${ids.map(() => '?').join(',')})`, [status, ...ids]);
}
async function findExpiredActiveReservations(limit = 200, conn = pool) {
  const [rows] = await conn.query(
    `SELECT id, tenant_id, branch_id, order_id, ingredient_id, qty FROM stock_reservations
      WHERE status = 'ACTIVE' AND expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP
      ORDER BY id LIMIT :limit`,
    { limit }
  );
  return rows;
}

// -------- proveedores / compras
async function listSuppliers(tenantId, conn = pool) {
  const [rows] = await conn.query(`SELECT id, code, name FROM suppliers WHERE tenant_id = :tenantId AND deleted_at IS NULL ORDER BY name`, { tenantId });
  return rows;
}
async function createSupplier(tenantId, d, conn = pool) {
  const [r] = await conn.query(`INSERT INTO suppliers (tenant_id, code, name) VALUES (:tenantId, :code, :name)`, { tenantId, code: d.code, name: d.name });
  return r.insertId;
}
async function createPurchase(tenantId, branchId, d, actorId, conn = pool) {
  const [r] = await conn.query(
    `INSERT INTO purchases (tenant_id, branch_id, supplier_id, status, total, note, created_by, received_at)
     VALUES (:tenantId, :branchId, :supplierId, 'RECEIVED', :total, :note, :actorId, CURRENT_TIMESTAMP)`,
    { tenantId, branchId, supplierId: d.supplierId ?? null, total: d.total ?? 0, note: d.note ?? null, actorId: actorId ?? null }
  );
  return r.insertId;
}
async function addPurchaseItem(tenantId, purchaseId, ingredientId, qty, unitCost, conn = pool) {
  await conn.query(
    `INSERT INTO purchase_items (tenant_id, purchase_id, ingredient_id, qty, unit_cost) VALUES (:tenantId, :purchaseId, :ingredientId, :qty, :unitCost)`,
    { tenantId, purchaseId, ingredientId, qty, unitCost: unitCost ?? 0 }
  );
}

// disponibilidad estimada por producto (para el menú). Devuelve
// Map<productId, number|null> (null = sin límite de stock).
async function availabilityByProduct(tenantId, branchId, productIds, conn = pool) {
  const out = new Map(productIds.map((id) => [id, null]));
  if (!productIds.length) return out;
  const ph = productIds.map(() => '?').join(',');
  const [rows] = await conn.query(
    `SELECT r.product_id, r.yield_qty, ri.ingredient_id, ri.qty AS per_yield,
            i.is_tracked, s.qty_on_hand, s.qty_reserved
       FROM recipes r
       JOIN recipe_items ri ON ri.recipe_id = r.id
       JOIN ingredients i ON i.id = ri.ingredient_id AND i.deleted_at IS NULL
       LEFT JOIN stock s ON s.tenant_id = r.tenant_id AND s.branch_id = ? AND s.ingredient_id = ri.ingredient_id
      WHERE r.tenant_id = ? AND r.variant_id IS NULL AND r.product_id IN (${ph})`,
    [branchId, tenantId, ...productIds]
  );
  for (const row of rows) {
    if (!row.is_tracked) continue;
    const perUnit = Number(row.per_yield) / (Number(row.yield_qty) || 1);
    if (perUnit <= 0) continue;
    const avail = row.qty_on_hand == null ? 0 : Number(row.qty_on_hand) - Number(row.qty_reserved);
    const canMake = Math.max(0, Math.floor(avail / perUnit));
    const cur = out.get(row.product_id);
    out.set(row.product_id, cur == null ? canMake : Math.min(cur, canMake));
  }
  return out;
}

module.exports = {
  listIngredients, findIngredient, findIngredientByCode, createIngredient, updateIngredient,
  getRecipe, resolveRecipe, upsertRecipe,
  listStock, ensureStockRow, lockStockRows, adjustStockQty, setReorderPoint,
  recordMovement, listMovements,
  insertReservation, activeReservationsForOrder, setReservationStatus, findExpiredActiveReservations,
  listSuppliers, createSupplier, createPurchase, addPurchaseItem,
  availabilityByProduct,
};
