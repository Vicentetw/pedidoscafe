// Aislamiento entre empresas — stock. Dos empresas con ingrediente de igual
// código; las reservas y movimientos de A nunca tocan B.
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { resetTenant } = require('./helpers/db');
const invRepo = require('../src/modules/inventory/inventory.repository');
const orderSvc = require('../src/modules/orders/orders.service');
const { withTransaction } = require('../src/withTransaction');

const TA = 999730;
const TB = 999731;
let a = {};
let b = {};

async function seed(tid, label, onHand) {
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [tid, `Stk ${label}`, `stk-${label.toLowerCase()}-iso`]);
  const [br] = await db.query('INSERT INTO branches (tenant_id, code, name) VALUES (?, ?, ?)', [tid, 'centro', `C ${label}`]);
  const [m] = await db.query('INSERT INTO menus (tenant_id, branch_id, code, name) VALUES (?, NULL, ?, ?)', [tid, 'p', 'P']);
  const [c] = await db.query('INSERT INTO menu_categories (tenant_id, menu_id, code, name) VALUES (?, ?, ?, ?)', [tid, m.insertId, 'g', 'G']);
  const [p] = await db.query('INSERT INTO products (tenant_id, category_id, code, name, base_price) VALUES (?, ?, ?, ?, ?)', [tid, c.insertId, 'sandwich', `S ${label}`, '5000.00']);
  const panId = await invRepo.createIngredient(tid, { code: 'pan', name: 'Pan', unit: 'unit', isTracked: true });
  await withTransaction((conn) => invRepo.upsertRecipe(tid, p.insertId, null, 1, [{ ingredientId: panId, qty: 1 }], conn));
  await invRepo.ensureStockRow(tid, br.insertId, panId);
  await db.query('UPDATE stock SET qty_on_hand = ? WHERE tenant_id = ? AND ingredient_id = ?', [onHand, tid, panId]);
  return { branchId: br.insertId, productId: p.insertId, panId };
}

before(async () => {
  await resetTenant(TA);
  await resetTenant(TB);
  a = await seed(TA, 'A', 1);
  b = await seed(TB, 'B', 1);
});

after(async () => {
  await resetTenant(TA);
  await resetTenant(TB);
  await db.end().catch(() => {});
});

test('reservar en A no afecta el stock de B (mismo código de ingrediente)', async () => {
  const o = await orderSvc.createOrder(TA, { branchId: a.branchId, channel: 'COUNTER' }, { kind: 'staff', actorId: null });
  await orderSvc.addItem(TA, o.id, { productCode: 'sandwich', qty: 1 }, { kind: 'staff' });
  await orderSvc.submitOrder(TA, o.id, { kind: 'staff', actorId: null });

  const [[sA]] = await db.query('SELECT qty_reserved FROM stock WHERE tenant_id = ? AND ingredient_id = ?', [TA, a.panId]);
  const [[sB]] = await db.query('SELECT qty_reserved, qty_on_hand FROM stock WHERE tenant_id = ? AND ingredient_id = ?', [TB, b.panId]);
  assert.equal(Number(sA.qty_reserved), 1);
  assert.equal(Number(sB.qty_reserved), 0, 'B intacto');
  assert.equal(Number(sB.qty_on_hand), 1);

  const [[{ n: resA }]] = await db.query('SELECT COUNT(*) n FROM stock_reservations WHERE tenant_id = ?', [TA]);
  const [[{ n: resB }]] = await db.query('SELECT COUNT(*) n FROM stock_reservations WHERE tenant_id = ?', [TB]);
  assert.equal(resA, 1);
  assert.equal(resB, 0);
});

test('B todavía puede confirmar su propio sándwich (su stock nunca se tocó)', async () => {
  const o = await orderSvc.createOrder(TB, { branchId: b.branchId, channel: 'COUNTER' }, { kind: 'staff', actorId: null });
  await orderSvc.addItem(TB, o.id, { productCode: 'sandwich', qty: 1 }, { kind: 'staff' });
  const r = await orderSvc.submitOrder(TB, o.id, { kind: 'staff', actorId: null });
  assert.equal(r.status, 'QUEUED');
});

test('availabilityByProduct de A no ve recetas/stock de B', async () => {
  const mapA = await invRepo.availabilityByProduct(TA, a.branchId, [a.productId, b.productId]);
  assert.equal(mapA.get(a.productId), 0); // A ya reservó su única unidad
  assert.equal(mapA.get(b.productId), null); // producto de B: A no tiene su receta -> sin dato
});
