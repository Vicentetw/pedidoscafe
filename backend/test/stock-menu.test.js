// Caso obligatorio 8: un producto figura disponible en el menú, se agota,
// y (a) el menú público pasa a mostrarlo sin stock, (b) el submit lo
// rechaza con lenguaje humano (no un 409 crudo).
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { resetTenant } = require('./helpers/db');
const { startTestServer } = require('./helpers/server');
const invRepo = require('../src/modules/inventory/inventory.repository');
const orderSvc = require('../src/modules/orders/orders.service');
const { withTransaction } = require('../src/withTransaction');

const T = 999720;
const SLUG = 'stock-menu-test';
let srv;
let ctx = {};

before(async () => {
  srv = await startTestServer();
  await resetTenant(T);
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [T, 'Stock menú', SLUG]);
  const [b] = await db.query('INSERT INTO branches (tenant_id, code, name) VALUES (?, ?, ?)', [T, 'centro', 'Centro']);
  ctx.branchId = b.insertId;
  const [m] = await db.query('INSERT INTO menus (tenant_id, branch_id, code, name) VALUES (?, NULL, ?, ?)', [T, 'p', 'P']);
  const [c] = await db.query('INSERT INTO menu_categories (tenant_id, menu_id, code, name) VALUES (?, ?, ?, ?)', [T, m.insertId, 'g', 'G']);
  const [p] = await db.query('INSERT INTO products (tenant_id, category_id, code, name, base_price) VALUES (?, ?, ?, ?, ?)', [T, c.insertId, 'sandwich', 'Sándwich', '5000.00']);
  ctx.productId = p.insertId;
  ctx.panId = await invRepo.createIngredient(T, { code: 'pan', name: 'Pan', unit: 'unit', isTracked: true });
  await withTransaction((conn) => invRepo.upsertRecipe(T, ctx.productId, null, 1, [{ ingredientId: ctx.panId, qty: 1 }], conn));
  await invRepo.ensureStockRow(T, ctx.branchId, ctx.panId);
  await db.query('UPDATE stock SET qty_on_hand = 2 WHERE tenant_id = ? AND ingredient_id = ?', [T, ctx.panId]);
});

after(async () => {
  await resetTenant(T);
  await srv.close();
  await db.end().catch(() => {});
});

const menu = async () => (await (await fetch(`${srv.baseUrl}/api/public/menu/${SLUG}/centro`)).json());

test('con stock, el sándwich figura disponible con stockRemaining', async () => {
  const m = await menu();
  const prod = m.menus[0].categories[0].products.find((x) => x.code === 'sandwich');
  assert.equal(prod.available, true);
  assert.equal(prod.stockRemaining, 2);
});

test('al agotarse el stock, el menú lo muestra NO disponible', async () => {
  await db.query('UPDATE stock SET qty_on_hand = 0 WHERE tenant_id = ? AND ingredient_id = ?', [T, ctx.panId]);
  const m = await menu();
  const prod = m.menus[0].categories[0].products.find((x) => x.code === 'sandwich');
  assert.equal(prod.available, false);
  assert.equal(prod.stockRemaining, 0);
});

test('el submit rechaza con lenguaje humano (no un 409 crudo) y deja el pedido en REJECTED_STOCK', async () => {
  const o = await orderSvc.createOrder(T, { branchId: ctx.branchId, channel: 'COUNTER' }, { kind: 'staff', actorId: null });
  await orderSvc.addItem(T, o.id, { productCode: 'sandwich', qty: 1 }, { kind: 'staff' });
  await assert.rejects(
    () => orderSvc.submitOrder(T, o.id, { kind: 'staff', actorId: null }),
    (err) => {
      assert.equal(err.code, 'ITEM_UNAVAILABLE');
      assert.equal(err.status, 200); // no es un 409
      assert.match(err.message, /agot|stock/i);
      assert.ok(!/409|conflict/i.test(err.message));
      return true;
    }
  );
  const [[row]] = await db.query('SELECT status FROM orders WHERE id = ?', [o.id]);
  assert.equal(row.status, 'REJECTED_STOCK');
});

test('repuesto el stock, el mismo pedido se puede reenviar y confirma', async () => {
  await db.query('UPDATE stock SET qty_on_hand = 5 WHERE tenant_id = ? AND ingredient_id = ?', [T, ctx.panId]);
  const [[o]] = await db.query("SELECT id FROM orders WHERE tenant_id = ? AND status = 'REJECTED_STOCK' ORDER BY id DESC LIMIT 1", [T]);
  const r = await orderSvc.submitOrder(T, o.id, { kind: 'staff', actorId: null });
  assert.equal(r.status, 'QUEUED');
});
