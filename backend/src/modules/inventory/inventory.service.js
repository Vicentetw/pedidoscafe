const pool = require('../../db');
const repo = require('./inventory.repository');
const branchRepo = require('../platform/branches.repository');
const { withTransaction } = require('../../withTransaction');
const { writeAudit } = require('../../audit/audit');
const { NotFoundError, ConflictError, ValidationError } = require('../../errors');

const actorOf = (req) => req?.appUser?.id ?? null;

// -------- ingredientes
async function listIngredients(tenantId) {
  return repo.listIngredients(tenantId);
}
async function createIngredient(tenantId, input, req) {
  if (await repo.findIngredientByCode(tenantId, input.code)) throw new ConflictError('Ya existe un ingrediente con ese código.');
  const id = await repo.createIngredient(tenantId, input);
  await writeAudit({ req, tenantId, entityType: 'ingredient', entityId: id, action: 'create', after: input });
  return repo.findIngredient(tenantId, id);
}
async function updateIngredient(tenantId, id, patch, req) {
  const before = await repo.findIngredient(tenantId, id);
  if (!before) throw new NotFoundError('Ese ingrediente no existe.');
  await repo.updateIngredient(tenantId, id, patch);
  const after = await repo.findIngredient(tenantId, id);
  await writeAudit({ req, tenantId, entityType: 'ingredient', entityId: id, action: 'update', before, after });
  return after;
}

// -------- recetas
async function getRecipe(tenantId, productId) {
  const [[product]] = await pool.query(`SELECT id, name FROM products WHERE tenant_id = :tenantId AND id = :id AND deleted_at IS NULL`, { tenantId, id: productId });
  if (!product) throw new NotFoundError('Ese producto no existe.');
  const recipe = await repo.getRecipe(tenantId, productId, null);
  return { product, recipe };
}
async function setRecipe(tenantId, productId, { yieldQty = 1, items }, req) {
  const [[product]] = await pool.query(`SELECT id FROM products WHERE tenant_id = :tenantId AND id = :id AND deleted_at IS NULL`, { tenantId, id: productId });
  if (!product) throw new NotFoundError('Ese producto no existe.');
  // resolver códigos de ingrediente -> ids
  const resolved = [];
  for (const it of items) {
    const ing = await repo.findIngredientByCode(tenantId, it.ingredientCode);
    if (!ing) throw new ValidationError(`El ingrediente "${it.ingredientCode}" no existe.`);
    resolved.push({ ingredientId: ing.id, qty: it.qty });
  }
  await withTransaction(async (conn) => {
    await repo.upsertRecipe(tenantId, productId, null, yieldQty, resolved, conn);
    // asegurar filas de stock (qty 0) para cada ingrediente en cada sucursal
    const branches = await branchRepo.list(tenantId, {}, conn);
    for (const r of resolved) {
      for (const b of branches) await repo.ensureStockRow(tenantId, b.id, r.ingredientId, conn);
    }
  });
  await writeAudit({ req, tenantId, entityType: 'recipe', entityId: productId, action: 'set', after: { yieldQty, items } });
  return getRecipe(tenantId, productId);
}

// -------- stock
async function listStock(tenantId, branchId) {
  if (!(await branchRepo.findById(tenantId, branchId))) throw new ValidationError('Esa sucursal no existe.');
  return repo.listStock(tenantId, branchId);
}
async function listMovements(tenantId, branchId, filters) {
  return repo.listMovements(tenantId, branchId, filters);
}
// Ajuste manual: fija el on_hand a un valor (delta = nuevo - actual) y
// deja un movimiento ADJUST o WASTE. inventory:adjust.
async function adjustStock(tenantId, branchId, { ingredientCode, newOnHand, waste = false, reason }, req) {
  const ing = await repo.findIngredientByCode(tenantId, ingredientCode);
  if (!ing) throw new ValidationError(`El ingrediente "${ingredientCode}" no existe.`);
  return withTransaction(async (conn) => {
    await repo.ensureStockRow(tenantId, branchId, ing.id, conn);
    const rows = await repo.lockStockRows(tenantId, branchId, [ing.id], conn);
    const cur = rows[0] ? Number(rows[0].qty_on_hand) : 0;
    const delta = Number(newOnHand) - cur;
    await repo.adjustStockQty(tenantId, branchId, ing.id, { onHandDelta: delta }, conn);
    await repo.recordMovement(tenantId, branchId, ing.id, waste ? 'WASTE' : 'ADJUST', delta, {
      reason: reason ?? null, actorUserId: actorOf(req),
    }, conn);
    await writeAudit({
      req, tenantId, branchId, entityType: 'stock', entityId: `${branchId}:${ing.id}`,
      action: waste ? 'waste' : 'adjust', before: { qty_on_hand: cur }, after: { qty_on_hand: Number(newOnHand) }, reason,
    });
    return (await repo.listStock(tenantId, branchId, conn)).find((s) => s.ingredient_id === ing.id);
  });
}
async function setReorderPoint(tenantId, branchId, { ingredientCode, value }, req) {
  const ing = await repo.findIngredientByCode(tenantId, ingredientCode);
  if (!ing) throw new ValidationError(`El ingrediente "${ingredientCode}" no existe.`);
  await repo.setReorderPoint(tenantId, branchId, ing.id, value);
  await writeAudit({ req, tenantId, branchId, entityType: 'stock', entityId: `${branchId}:${ing.id}`, action: 'reorder_point', after: { value } });
}

// -------- compras (ingreso de stock). inventory:purchase.
async function createPurchase(tenantId, branchId, input, req) {
  if (!(await branchRepo.findById(tenantId, branchId))) throw new ValidationError('Esa sucursal no existe.');
  const lines = [];
  for (const it of input.items) {
    const ing = await repo.findIngredientByCode(tenantId, it.ingredientCode);
    if (!ing) throw new ValidationError(`El ingrediente "${it.ingredientCode}" no existe.`);
    lines.push({ ingredientId: ing.id, qty: it.qty, unitCost: it.unitCost ?? 0 });
  }
  const total = lines.reduce((a, l) => a + l.qty * l.unitCost, 0);
  const purchaseId = await withTransaction(async (conn) => {
    const pid = await repo.createPurchase(tenantId, branchId, { supplierId: input.supplierId, total, note: input.note }, actorOf(req), conn);
    for (const l of lines) {
      await repo.ensureStockRow(tenantId, branchId, l.ingredientId, conn);
      await repo.lockStockRows(tenantId, branchId, [l.ingredientId], conn);
      await repo.addPurchaseItem(tenantId, pid, l.ingredientId, l.qty, l.unitCost, conn);
      await repo.adjustStockQty(tenantId, branchId, l.ingredientId, { onHandDelta: l.qty }, conn);
      await repo.recordMovement(tenantId, branchId, l.ingredientId, 'PURCHASE', l.qty, { refType: 'purchase', refId: pid, actorUserId: actorOf(req) }, conn);
    }
    return pid;
  });
  await writeAudit({ req, tenantId, branchId, entityType: 'purchase', entityId: purchaseId, action: 'create', after: { total, lines: input.items } });
  return { id: purchaseId, total: total.toFixed(2) };
}

// -------- proveedores
async function listSuppliers(tenantId) {
  return repo.listSuppliers(tenantId);
}
async function createSupplier(tenantId, input, req) {
  const id = await repo.createSupplier(tenantId, input);
  await writeAudit({ req, tenantId, entityType: 'supplier', entityId: id, action: 'create', after: input });
  return { id };
}

module.exports = {
  listIngredients, createIngredient, updateIngredient,
  getRecipe, setRecipe,
  listStock, listMovements, adjustStock, setReorderPoint,
  createPurchase, listSuppliers, createSupplier,
};
