const pool = require('../../db');
const repo = require('./inventory.repository');
const settingsRepo = require('../platform/settings.repository');

// Motor de reserva de stock (ARQUITECTURA_V1 §8, §11-12). Todo corre
// DENTRO de la transacción del submit del pedido (recibe `conn`), con lock
// pesimista `SELECT ... FOR UPDATE` sobre las filas de `stock`, tomadas
// SIEMPRE en orden por ingredient_id para no deadlockear.

// Necesidad de ingredientes de una lista de order_items.
// Devuelve Map<ingredient_id, { qty, isTracked, productNames:Set }>.
async function ingredientNeeds(tenantId, items, conn) {
  const needs = new Map();
  for (const it of items) {
    const recipe = await repo.resolveRecipe(tenantId, it.product_id, it.variant_id ?? null, conn);
    if (!recipe) continue; // producto sin receta -> no consume stock
    const yieldQty = recipe.yieldQty || 1;
    for (const ri of recipe.items) {
      const perUnit = Number(ri.qty) / yieldQty;
      const total = perUnit * Number(it.qty);
      const cur = needs.get(ri.ingredient_id) || { qty: 0, isTracked: !!ri.is_tracked, productNames: new Set() };
      cur.qty += total;
      cur.productNames.add(it.name_snapshot);
      needs.set(ri.ingredient_id, cur);
    }
  }
  return needs;
}

/**
 * Reserva el stock para un pedido que se está confirmando.
 * @returns {{ ok:true }} | {{ ok:false, unavailable:[{name}] }}
 */
async function reserveForOrder(tenantId, branchId, orderId, items, conn) {
  const needs = await ingredientNeeds(tenantId, items, conn);
  const tracked = [...needs.entries()].filter(([, v]) => v.isTracked);
  if (!tracked.length) return { ok: true };

  const ingredientIds = tracked.map(([id]) => id).sort((a, b) => a - b);
  const rows = await repo.lockStockRows(tenantId, branchId, ingredientIds, conn);
  const byId = new Map(rows.map((r) => [r.ingredient_id, r]));

  const unavailable = [];
  for (const [ingredientId, need] of tracked) {
    const row = byId.get(ingredientId);
    const available = row ? Number(row.qty_on_hand) - Number(row.qty_reserved) : 0;
    if (available + 1e-9 < need.qty) {
      for (const n of need.productNames) unavailable.push({ name: n });
    }
  }
  if (unavailable.length) {
    // dedupe por nombre
    const seen = new Set();
    return { ok: false, unavailable: unavailable.filter((u) => !seen.has(u.name) && seen.add(u.name)) };
  }

  const ttlMin = (await settingsRepo.get(tenantId, 'orders.reservation_ttl_minutes', null, conn)) ?? 240;
  const expiresAt = new Date(Date.now() + ttlMin * 60000).toISOString().slice(0, 19).replace('T', ' ');

  for (const [ingredientId, need] of tracked) {
    await repo.adjustStockQty(tenantId, branchId, ingredientId, { reservedDelta: need.qty }, conn);
    await repo.insertReservation(tenantId, branchId, orderId, ingredientId, need.qty, expiresAt, conn);
    await repo.recordMovement(tenantId, branchId, ingredientId, 'RESERVE', -need.qty, { refType: 'order', refId: orderId }, conn);
  }
  return { ok: true };
}

// Libera las reservas ACTIVE de un pedido (cancelación / rechazo / timeout).
async function releaseForOrder(tenantId, orderId, conn) {
  const reservations = await repo.activeReservationsForOrder(tenantId, orderId, conn);
  if (!reservations.length) return;
  // lock ordenado
  const byBranch = new Map();
  for (const r of reservations) {
    if (!byBranch.has(r.branch_id)) byBranch.set(r.branch_id, []);
    byBranch.get(r.branch_id).push(r);
  }
  for (const [branchId, list] of byBranch) {
    const ids = [...new Set(list.map((r) => r.ingredient_id))].sort((a, b) => a - b);
    await repo.lockStockRows(tenantId, branchId, ids, conn);
    for (const r of list) {
      await repo.adjustStockQty(tenantId, branchId, r.ingredient_id, { reservedDelta: -Number(r.qty) }, conn);
      await repo.recordMovement(tenantId, branchId, r.ingredient_id, 'RELEASE', Number(r.qty), { refType: 'order', refId: orderId }, conn);
    }
  }
  await repo.setReservationStatus(reservations.map((r) => r.id), 'RELEASED', conn);
}

// Consume las reservas de un pedido entregado: baja qty_reserved y qty_on_hand.
async function consumeForOrder(tenantId, orderId, conn) {
  const reservations = await repo.activeReservationsForOrder(tenantId, orderId, conn);
  if (!reservations.length) return;
  const byBranch = new Map();
  for (const r of reservations) {
    if (!byBranch.has(r.branch_id)) byBranch.set(r.branch_id, []);
    byBranch.get(r.branch_id).push(r);
  }
  for (const [branchId, list] of byBranch) {
    const ids = [...new Set(list.map((r) => r.ingredient_id))].sort((a, b) => a - b);
    await repo.lockStockRows(tenantId, branchId, ids, conn);
    for (const r of list) {
      await repo.adjustStockQty(tenantId, branchId, r.ingredient_id, { onHandDelta: -Number(r.qty), reservedDelta: -Number(r.qty) }, conn);
      await repo.recordMovement(tenantId, branchId, r.ingredient_id, 'CONSUME', -Number(r.qty), { refType: 'order', refId: orderId }, conn);
    }
  }
  await repo.setReservationStatus(reservations.map((r) => r.id), 'CONSUMED', conn);
}

// Disponibilidad por producto para el menú (no bloquea nada; es UX).
async function availabilityForProducts(tenantId, branchId, productIds) {
  return repo.availabilityByProduct(tenantId, branchId, productIds, pool);
}

module.exports = { reserveForOrder, releaseForOrder, consumeForOrder, availabilityForProducts, ingredientNeeds };
