// Motor de reserva de stock — casos obligatorios 1 (concurrencia) y el
// ciclo reserva → consumo / liberación. Sin Firebase.
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { resetTenant } = require('./helpers/db');
const orderSvc = require('../src/modules/orders/orders.service');
const kitchenSvc = require('../src/modules/orders/kitchen.service');
const invRepo = require('../src/modules/inventory/inventory.repository');
const { withTransaction } = require('../src/withTransaction');

const T = 999710;
let ctx = {};

async function setStock(onHand) {
  await db.query('UPDATE stock SET qty_on_hand = ?, qty_reserved = 0 WHERE tenant_id = ? AND ingredient_id = ?', [onHand, T, ctx.panId]);
  await db.query('DELETE FROM stock_reservations WHERE tenant_id = ?', [T]);
  await db.query('DELETE FROM stock_movements WHERE tenant_id = ?', [T]);
}
async function newSandwichOrder() {
  const o = await orderSvc.createOrder(T, { branchId: ctx.branchId, channel: 'COUNTER' }, { kind: 'staff', actorId: null });
  await orderSvc.addItem(T, o.id, { productCode: 'sandwich', qty: 1 }, { kind: 'staff' });
  return o.id;
}
const stockRow = async () => (await db.query('SELECT qty_on_hand, qty_reserved FROM stock WHERE tenant_id = ? AND ingredient_id = ?', [T, ctx.panId]))[0][0];

before(async () => {
  await resetTenant(T);
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [T, 'Stock', 'stock-test']);
  const [b] = await db.query('INSERT INTO branches (tenant_id, code, name) VALUES (?, ?, ?)', [T, 'centro', 'Centro']);
  ctx.branchId = b.insertId;
  const [m] = await db.query('INSERT INTO menus (tenant_id, branch_id, code, name) VALUES (?, NULL, ?, ?)', [T, 'p', 'P']);
  const [c] = await db.query('INSERT INTO menu_categories (tenant_id, menu_id, code, name) VALUES (?, ?, ?, ?)', [T, m.insertId, 'g', 'G']);
  const [p] = await db.query('INSERT INTO products (tenant_id, category_id, code, name, base_price) VALUES (?, ?, ?, ?, ?)', [T, c.insertId, 'sandwich', 'Sándwich', '5000.00']);
  ctx.productId = p.insertId;
  await db.query('INSERT INTO products (tenant_id, category_id, code, name, base_price) VALUES (?, ?, ?, ?, ?)', [T, c.insertId, 'agua', 'Agua', '900.00']); // sin receta

  ctx.panId = await invRepo.createIngredient(T, { code: 'pan', name: 'Pan', unit: 'unit', isTracked: true });
  await withTransaction((conn) => invRepo.upsertRecipe(T, ctx.productId, null, 1, [{ ingredientId: ctx.panId, qty: 1 }], conn));
  await invRepo.ensureStockRow(T, ctx.branchId, ctx.panId);
});

after(async () => {
  await resetTenant(T);
  await db.end().catch(() => {});
});

test('producto sin receta -> se confirma sin tocar stock', async () => {
  await setStock(0);
  const o = await orderSvc.createOrder(T, { branchId: ctx.branchId, channel: 'COUNTER' }, { kind: 'staff', actorId: null });
  await orderSvc.addItem(T, o.id, { productCode: 'agua', qty: 3 }, { kind: 'staff' });
  const r = await orderSvc.submitOrder(T, o.id, { kind: 'staff', actorId: null });
  assert.equal(r.status, 'QUEUED');
});

test('CASO OBLIGATORIO 1: stock = 1, dos submits simultáneos -> sólo uno obtiene el producto', async () => {
  await setStock(1);
  const idA = await newSandwichOrder();
  const idB = await newSandwichOrder();

  const [rA, rB] = await Promise.allSettled([
    orderSvc.submitOrder(T, idA, { kind: 'staff', actorId: null }),
    orderSvc.submitOrder(T, idB, { kind: 'staff', actorId: null }),
  ]);
  const statuses = [];
  for (const [id, r] of [[idA, rA], [idB, rB]]) {
    if (r.status === 'fulfilled') statuses.push(r.value.status);
    else {
      // el rechazo llega como DomainError code ITEM_UNAVAILABLE (status 200)
      assert.equal(r.reason.code, 'ITEM_UNAVAILABLE');
      const [[o]] = await db.query('SELECT status FROM orders WHERE id = ?', [id]);
      statuses.push(o.status);
    }
  }
  statuses.sort();
  assert.deepEqual(statuses, ['QUEUED', 'REJECTED_STOCK']);

  const s = await stockRow();
  assert.equal(Number(s.qty_reserved), 1, 'sólo 1 unidad reservada');
  const [[{ n }]] = await db.query("SELECT COUNT(*) n FROM stock_reservations WHERE tenant_id = ? AND status = 'ACTIVE'", [T]);
  assert.equal(n, 1, 'una sola reserva ACTIVE');
});

test('cancelar un pedido confirmado libera la reserva (RELEASE en el ledger)', async () => {
  await setStock(2);
  const id = await newSandwichOrder();
  await orderSvc.submitOrder(T, id, { kind: 'staff', actorId: null });
  assert.equal(Number((await stockRow()).qty_reserved), 1);

  await orderSvc.cancelOrder(T, id, { reason: 'test' }, { kind: 'staff', actorId: null, canCancelAfterPrep: true, req: {} });
  const s = await stockRow();
  assert.equal(Number(s.qty_reserved), 0);
  assert.equal(Number(s.qty_on_hand), 2, 'on_hand intacto');
  const [[res]] = await db.query('SELECT status FROM stock_reservations WHERE tenant_id = ? ORDER BY id DESC LIMIT 1', [T]);
  assert.equal(res.status, 'RELEASED');
  const [[rel]] = await db.query("SELECT qty FROM stock_movements WHERE tenant_id = ? AND type = 'RELEASE' ORDER BY id DESC LIMIT 1", [T]);
  assert.equal(Number(rel.qty), 1);
});

test('entregar el pedido CONSUME el stock (on_hand y reserved bajan; CONSUME en el ledger)', async () => {
  await setStock(2);
  const id = await newSandwichOrder();
  await orderSvc.submitOrder(T, id, { kind: 'staff', actorId: null });
  const [[tk]] = await db.query('SELECT id FROM kitchen_tickets WHERE tenant_id = ? AND order_id = ?', [T, id]);
  await kitchenSvc.advanceTicket(T, tk.id, {}, null); // QUEUED->PREPARING
  await kitchenSvc.advanceTicket(T, tk.id, {}, null); // PREPARING->READY
  await kitchenSvc.advanceTicket(T, tk.id, {}, null); // READY->DELIVERED

  const s = await stockRow();
  assert.equal(Number(s.qty_on_hand), 1, 'se consumió 1');
  assert.equal(Number(s.qty_reserved), 0);
  const [[res]] = await db.query('SELECT status FROM stock_reservations WHERE tenant_id = ? ORDER BY id DESC LIMIT 1', [T]);
  assert.equal(res.status, 'CONSUMED');
  const [[con]] = await db.query("SELECT qty FROM stock_movements WHERE tenant_id = ? AND type = 'CONSUME' ORDER BY id DESC LIMIT 1", [T]);
  assert.equal(Number(con.qty), -1);
});

test('el ledger reconstruye el on_hand: sum(PURCHASE+ADJUST+CONSUME+WASTE) == on_hand actual', async () => {
  await setStock(0);
  // simular: compra de 10, consumo de 3 (vía un pedido entregado)
  await db.query('UPDATE stock SET qty_on_hand = 10 WHERE tenant_id = ? AND ingredient_id = ?', [T, ctx.panId]);
  await db.query("INSERT INTO stock_movements (tenant_id, branch_id, ingredient_id, type, qty) VALUES (?, ?, ?, 'PURCHASE', 10)", [T, ctx.branchId, ctx.panId]);
  const id = await newSandwichOrder();
  await orderSvc.submitOrder(T, id, { kind: 'staff', actorId: null });
  const [[tk]] = await db.query('SELECT id FROM kitchen_tickets WHERE tenant_id = ? AND order_id = ?', [T, id]);
  for (let i = 0; i < 3; i++) await kitchenSvc.advanceTicket(T, tk.id, {}, null);

  const [[sum]] = await db.query(
    "SELECT COALESCE(SUM(qty),0) s FROM stock_movements WHERE tenant_id = ? AND ingredient_id = ? AND type IN ('PURCHASE','ADJUST','CONSUME','WASTE','TRANSFER_IN','TRANSFER_OUT')",
    [T, ctx.panId]
  );
  const s = await stockRow();
  assert.equal(Number(sum.s), Number(s.qty_on_hand));
});
